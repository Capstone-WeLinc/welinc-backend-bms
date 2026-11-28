import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { WorkService } from './work.service';
import { reportedDraftMethod } from '../collections/collections.service';

/* ---------- In-memory stand-ins for the completion database, Booking and Dispatch ---------- */

type Row = Record<string, any>;
const DRIVER = randomUUID();
const OTHER_DRIVER = randomUUID();
const CS = randomUUID();
const BOOKING = randomUUID();
const NOT_MINE = randomUUID();

let outcomes: Row[];
let clock: number;
let bookingStatus: string;
let commands: Row[];

/** Each write moves updatedAt forward, like Prisma's @updatedAt. */
const stamp = () => new Date((clock += 1000));

function setup() {
  outcomes = [];
  clock = Date.parse('2026-12-01T00:00:00Z');
  bookingStatus = 'Assigned';
  commands = [];
  const find = (where: Row) => outcomes.find((row) => row.bookingUuid === where.bookingUuid) ?? null;
  const workOutcome = {
    findUnique: async ({ where }: any) => find(where),
    findUniqueOrThrow: async ({ where }: any) => find(where)!,
    findMany: async ({ where }: any) => outcomes.filter((row) => where.bookingUuid.in.includes(row.bookingUuid)),
    upsert: async ({ where, create, update }: any) => {
      const row = find(where);
      if (row) Object.assign(row, update, { updatedAt: stamp() });
      else outcomes.push({ lastEditedBy: null, submittedBy: null, lastError: null, ...create, updatedAt: stamp() });
      return find(where);
    },
    updateMany: async ({ where, data }: any) => {
      const row = find(where);
      if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      Object.assign(row, data, { updatedAt: stamp() });
      return { count: 1 };
    },
    update: async ({ where, data }: any) => Object.assign(find(where)!, data, { updatedAt: stamp() }),
  };
  const prisma: any = {
    workOutcome,
    collection: { findMany: async () => [] },
    refund: { findMany: async () => [] },
    notificationOutbox: { createMany: async () => ({ count: 1 }) },
  };
  prisma.$transaction = async (fn: (tx: any) => any) => fn(prisma);
  const booking = () => ({
    id: BOOKING, bookingId: 'WL-1', bookingNo: 'BK-0001', client: 'Dela Cruz', service: 'House Moving',
    date: '2026-12-01', status: bookingStatus, version: 3, amount: '3000.00', downpayment: null, protectiveMaterials: [],
  });
  const bookings: any = {
    resolve: async (id: string) => ({ ...booking(), id }),
    get: async (id: string) => ({ ...booking(), id }),
    command: async (_id: string, body: Row) => { commands.push(body); bookingStatus = 'Completed'; return { applied: true }; },
  };
  const dispatch: any = {
    postServiceReadyBookingUuids: async () => [BOOKING, NOT_MINE],
    driverBookingUuids: async (userId: string) => (userId === DRIVER ? [BOOKING] : []),
  };
  return new WorkService(prisma, bookings, dispatch);
}

const form = (extra: Row = {}) => ({
  serviceCompleted: true, arrivalTime: '14:30', addOns: ['Bubble wrap'], paymentMethod: 'BANK_TRANSFER', addOnPayment: 'COD',
  completionNotes: 'Client happy', issueReported: false, issueDetails: '', submittedAt: '2026-12-01T06:30:00.000Z', baseVersion: null, ...extra,
});

async function conflictCode(promise: Promise<unknown>) {
  try { await promise; } catch (error) {
    if (error instanceof ConflictException) return (error.getResponse() as Row).code ?? 'CONFLICT';
    throw error;
  }
  throw new Error('expected a conflict');
}

describe('WorkService.submitFromTeam', () => {
  it("saves the assigned driver's form, completes the booking and never makes the driver the finalizer", async () => {
    const service = setup();
    const answer = await service.submitFromTeam(BOOKING, form(), DRIVER);
    const saved = outcomes[0];
    expect(saved).toMatchObject({
      status: 'COMPLETED', postServiceStatus: 'Completed', arrivalTime: '14:30', additionalMaterials: ['Bubble wrap'],
      completionNotes: 'Client happy', issueDetails: null, submittedBy: DRIVER, lastEditedBy: DRIVER,
      finalizedBy: null, finalizedAt: null, reportedPaymentMethod: 'BDO', reportedAddOnPayment: 'Cash',
    });
    expect(saved.submittedAt.toISOString()).toBe('2026-12-01T06:30:00.000Z');
    expect(commands).toHaveLength(1);
    expect(answer).toMatchObject({ bookingUuid: BOOKING, postServiceLocked: false, reportedPaymentMethod: 'BDO', version: saved.updatedAt.toISOString() });
  });

  it('saves a draft when the service is not completed and no issue is reported', async () => {
    const service = setup();
    await service.submitFromTeam(BOOKING, form({ serviceCompleted: false }), DRIVER);
    expect(outcomes[0]).toMatchObject({ status: 'DRAFT', postServiceStatus: 'Pending Review' });
    expect(commands).toHaveLength(0);
  });

  it('refuses anyone who is not the assigned driver', async () => {
    const service = setup();
    await expect(service.submitFromTeam(BOOKING, form(), OTHER_DRIVER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.submitFromTeam(NOT_MINE, form(), DRIVER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(outcomes).toHaveLength(0);
  });

  it.each([
    [{ paymentMethod: 'CHEQUE' }], [{ addOnPayment: 'IOU' }], [{ addOns: 'Bubble wrap' }], [{ arrivalTime: '25:00' }],
    [{ submittedAt: 'yesterday' }], [{ issueReported: true, issueDetails: '' }], [{ serviceCompleted: 'yes' }],
  ])('rejects invalid details %p', async (extra) => {
    await expect(setup().submitFromTeam(BOOKING, form(extra), DRIVER)).rejects.toBeInstanceOf(BadRequestException);
    expect(outcomes).toHaveLength(0);
  });

  it('accepts a resubmission with the version it was given', async () => {
    const service = setup();
    const first = await service.submitFromTeam(BOOKING, form(), DRIVER);
    await service.submitFromTeam(BOOKING, form({ completionNotes: 'Fixed typo', baseVersion: first.version }), DRIVER);
    expect(outcomes[0].completionNotes).toBe('Fixed typo');
  });

  it("accepts a retry of the driver's own save even with an old version (lost reply)", async () => {
    const service = setup();
    await service.submitFromTeam(BOOKING, form(), DRIVER);
    await service.submitFromTeam(BOOKING, form({ completionNotes: 'Sent again', baseVersion: null }), DRIVER);
    expect(outcomes[0].completionNotes).toBe('Sent again');
  });

  it('refuses a resubmission from a copy older than an office edit, and keeps the office edit', async () => {
    const service = setup();
    const first = await service.submitFromTeam(BOOKING, form(), DRIVER);
    await service.upsert(BOOKING, { status: 'Completed', arrivalTime: '14:00', additionalMaterials: ['Bubble wrap', 'Extra helper'], completionNotes: 'Client happy' }, CS);
    expect(outcomes[0]).toMatchObject({ lastEditedBy: CS, finalizedBy: CS });
    let current: Row | undefined;
    try {
      await service.submitFromTeam(BOOKING, form({ completionNotes: 'Fixed typo', baseVersion: first.version }), DRIVER);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as Row;
      expect(body.code).toBe('POST_SERVICE_CHANGED');
      current = body.current;
    }
    expect(current).toMatchObject({ arrivalTime: '14:00', additionalMaterials: ['Bubble wrap', 'Extra helper'], version: outcomes[0].updatedAt.toISOString() });
    expect(outcomes[0]).toMatchObject({ arrivalTime: '14:00', completionNotes: 'Client happy' });
    // Submitting again on top of the office's version is accepted.
    await service.submitFromTeam(BOOKING, form({ arrivalTime: '14:00', completionNotes: 'Fixed typo', baseVersion: current!.version }), DRIVER);
    expect(outcomes[0].completionNotes).toBe('Fixed typo');
  });

  it('refuses any submission once the office has finalized', async () => {
    const service = setup();
    const first = await service.submitFromTeam(BOOKING, form(), DRIVER);
    outcomes[0].postServiceStatus = 'Finalized';
    expect(await conflictCode(service.submitFromTeam(BOOKING, form({ baseVersion: first.version }), DRIVER))).toBe('POST_SERVICE_FINALIZED');
  });

  it('refuses when the record changes between the check and the write', async () => {
    const service = setup();
    const first = await service.submitFromTeam(BOOKING, form(), DRIVER);
    // Someone saves in between: the stored version moves after the check has read it.
    const realFind = (service as any).prisma.workOutcome.findUnique;
    (service as any).prisma.workOutcome.findUnique = async (args: any) => {
      const row = await realFind(args);
      const copy = row && { ...row };
      if (row) row.updatedAt = stamp();
      return copy;
    };
    expect(await conflictCode(service.submitFromTeam(BOOKING, form({ baseVersion: first.version }), DRIVER))).toBe('POST_SERVICE_CHANGED');
  });
});

describe('WorkService.teamStatus', () => {
  it("lists the driver's bookings with submitted, finalized and version", async () => {
    const service = setup();
    expect(await service.teamStatus(DRIVER)).toEqual({ items: [{ bookingUuid: BOOKING, submitted: false, finalized: false, version: null }] });
    await service.submitFromTeam(BOOKING, form(), DRIVER);
    outcomes[0].postServiceStatus = 'Finalized';
    expect(await service.teamStatus(DRIVER)).toEqual({ items: [{ bookingUuid: BOOKING, submitted: true, finalized: true, version: outcomes[0].updatedAt.toISOString() }] });
    expect(await service.teamStatus(OTHER_DRIVER)).toEqual({ items: [] });
  });
});

describe('WorkService.upsert (web)', () => {
  it('still rejects payment fields', async () => {
    await expect(setup().upsert(BOOKING, { status: 'Completed', paymentMethod: 'Cash' }, CS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps making the Customer Support user the finalizer and records who saved last', async () => {
    const service = setup();
    await service.upsert(BOOKING, { status: 'Completed', arrivalTime: '14:00' }, CS);
    expect(outcomes[0]).toMatchObject({ finalizedBy: CS, lastEditedBy: CS, submittedBy: null });
  });
});

describe('reportedDraftMethod', () => {
  it('accepts only the methods Daily Sales knows', () => {
    expect(reportedDraftMethod('BDO')).toBe('BDO');
    expect(reportedDraftMethod('GCash')).toBe('GCash');
    expect(reportedDraftMethod('Unpaid')).toBeNull();
    expect(reportedDraftMethod(null)).toBeNull();
  });
});
