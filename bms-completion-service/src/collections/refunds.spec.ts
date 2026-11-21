import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CollectionsService } from './collections.service';

/* ---------- In-memory stand-ins for the database and Booking service ---------- */

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return value !== cond.not;
    }
    return value === cond;
  });
}

function table(rows: Row[], defaults: () => Row = () => ({})) {
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return row;
    },
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...defaults(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return Object.assign(row, data);
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
}

const BOOKING = randomUUID();

function setup() {
  const prisma: any = {
    collection: table([]),
    refund: table([], () => ({ projectionState: 'PENDING', projectionError: null })),
    refundRequest: table([], () => ({ status: 'Requested', requestedAt: new Date(), decisionReason: null })),
    approvalAuditEvent: table([]),
    dailySubmission: table([]),
    $executeRaw: async () => 0,
  };
  prisma.$transaction = async (fn: (tx: any) => any) => fn(prisma);

  const booking = { id: BOOKING, version: 1, status: 'Confirmed', amount: '1000.00' };
  const commands: Row[] = [];
  let failNext = 0;
  const bookings: any = {
    get: async () => ({ ...booking }),
    command: async (_id: string, cmd: Row) => {
      if (failNext > 0) { failNext--; throw new ServiceUnavailableException('Booking service unavailable'); }
      commands.push(cmd);
      booking.version++;
      return { applied: true, duplicate: false, version: booking.version, status: booking.status };
    },
  };

  const service = new CollectionsService(prisma, bookings, {} as any);

  const addVerifiedCollection = (amount = '1000.00') =>
    prisma.collection.rows[prisma.collection.rows.push({
      id: randomUUID(), bookingUuid: BOOKING, bookingNo: 'BK-001', bookingIdAlias: 'B-001', clientName: 'Juan',
      amount, method: 'GCash', reference: 'REF1', status: 'VERIFIED', businessDate: '2026-11-20',
      garage: 'G', deliveryType: 'Inhouse', plateNumber: 'ABC', assignedTeam: 'T', recordedBy: 'cs-1',
    }) - 1];

  return { prisma, service, commands, addVerifiedCollection, failBookingSync: (n = 1) => { failNext = n; } };
}

const CS = 'cs-1';
const ADMIN = 'admin-1';

/* ---------------------------------- Tests ---------------------------------- */

describe('Refunds', () => {
  describe('Step 1 – CS requests a refund', () => {
    it('creates a pending request with an audit entry', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '300', reason: 'Damaged item' }, CS);
      expect(req.status).toBe('Requested');
      expect(t.prisma.approvalAuditEvent.rows).toEqual([expect.objectContaining({ action: 'submitted', itemId: req.id })]);
      expect(t.prisma.refund.rows).toHaveLength(0); // nothing refunded yet
    });

    it('refuses payments that are not verified', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      c.status = 'PENDING';
      await expect(t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS)).rejects.toThrow(ConflictException);
    });

    it('requires a reason', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      await expect(t.service.requestRefund(c.id, { amount: '100', reason: '  ' }, CS)).rejects.toThrow(BadRequestException);
    });

    it.each(['0', '-5', 'abc', '10.555'])('rejects invalid amount %s', async (amount) => {
      const t = setup();
      const c = t.addVerifiedCollection();
      await expect(t.service.requestRefund(c.id, { amount, reason: 'x' }, CS)).rejects.toThrow(BadRequestException);
    });

    it('refuses more than was paid', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('1000.00');
      await expect(t.service.requestRefund(c.id, { amount: '1000.01', reason: 'x' }, CS)).rejects.toThrow('exceeds');
    });

    it('allows only one pending request per payment', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await expect(t.service.requestRefund(c.id, { amount: '100', reason: 'y' }, CS)).rejects.toThrow('already pending');
    });

    it('counts earlier refunds against the remaining amount', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('1000.00');
      const first = await t.service.requestRefund(c.id, { amount: '600', reason: 'partial' }, CS);
      await t.service.decideApproval('refund', first.id, ADMIN, 'approve');
      await expect(t.service.requestRefund(c.id, { amount: '500', reason: 'more' }, CS)).rejects.toThrow('exceeds');
      await expect(t.service.requestRefund(c.id, { amount: '400', reason: 'rest' }, CS)).resolves.toBeDefined();
    });
  });

  describe('Step 2 – Admin decides', () => {
    it('blocks the requester from approving their own request', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await expect(t.service.decideApproval('refund', req.id, CS, 'approve')).rejects.toThrow('your own');
    });

    it('requires a reason to reject, then marks it Rejected', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await expect(t.service.decideApproval('refund', req.id, ADMIN, 'reject', '')).rejects.toThrow(BadRequestException);
      const rejected = await t.service.decideApproval('refund', req.id, ADMIN, 'reject', 'No proof');
      expect(rejected.status).toBe('Rejected');
      expect(rejected.decisionReason).toBe('No proof');
      expect(t.prisma.refund.rows).toHaveLength(0);
    });

    it('approving a full refund marks it Refunded and releases the booking payment hold', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('1000.00');
      const req = await t.service.requestRefund(c.id, { amount: '1000', reason: 'Cancelled' }, CS);
      const done = await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
      expect(done.status).toBe('Refunded');
      expect(t.prisma.refund.rows[0]).toEqual(expect.objectContaining({ projectionState: 'SYNCED', approvedBy: ADMIN }));
      expect(t.commands).toEqual([expect.objectContaining({ kind: 'SetPaymentHold', paymentHold: false })]);
    });

    it('approving a partial refund keeps the booking payment hold', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('1000.00');
      const req = await t.service.requestRefund(c.id, { amount: '250', reason: 'Discount' }, CS);
      await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
      expect(t.commands).toEqual([expect.objectContaining({ paymentHold: true })]);
    });

    it('cannot decide the same request twice', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
      await expect(t.service.decideApproval('refund', req.id, 'admin-2', 'approve')).rejects.toThrow('already been decided');
      expect(t.prisma.refund.rows).toHaveLength(1);
    });

    it('cannot approve once today\'s sales are submitted', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
      t.prisma.dailySubmission.rows.push({ date: today });
      await expect(t.service.decideApproval('refund', req.id, ADMIN, 'approve')).rejects.toThrow('already submitted');
    });
  });

  describe('Step 3 – Booking sync failure and retry', () => {
    it('keeps the refund pending when Booking is down, then Retry completes it', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      t.failBookingSync();
      await expect(t.service.decideApproval('refund', req.id, ADMIN, 'approve')).rejects.toThrow(ServiceUnavailableException);

      const refund = t.prisma.refund.rows[0];
      expect(refund.projectionState).toBe('PENDING');
      expect(refund.projectionError).toBeTruthy();
      expect(t.prisma.refundRequest.rows[0].status).toBe('Approved');
      expect(await t.service.pendingRefunds()).toHaveLength(1);

      const retried = await t.service.retryRefund(refund.id);
      expect(retried.projectionState).toBe('SYNCED');
      expect(t.prisma.refundRequest.rows[0].status).toBe('Refunded');
      expect(await t.service.pendingRefunds()).toHaveLength(0);
    });

    it('a pending (unsynced) refund does not show in sales yet', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      t.failBookingSync();
      await t.service.decideApproval('refund', req.id, ADMIN, 'approve').catch(() => undefined);
      const rows = await t.service.sales();
      expect(rows.filter((r) => r.amount.includes('-'))).toHaveLength(0);
    });
  });

  describe('Withdraw and resubmit', () => {
    it('requester can withdraw a pending request', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await expect(t.service.changeApprovalStatus('refund', req.id, 'cs-2', 'withdraw')).rejects.toThrow(ForbiddenException);
      const w = await t.service.changeApprovalStatus('refund', req.id, CS, 'withdraw');
      expect(w.status).toBe('Withdrawn');
    });

    it('requester can fix and resubmit a rejected request', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const req = await t.service.requestRefund(c.id, { amount: '100', reason: 'x' }, CS);
      await t.service.decideApproval('refund', req.id, ADMIN, 'reject', 'wrong amount');
      const again = await t.service.changeApprovalStatus('refund', req.id, CS, 'resubmit', { amount: '80', reason: 'fixed' });
      expect(again).toEqual(expect.objectContaining({ status: 'Requested', reason: 'fixed', decisionReason: null }));
      expect(Number(again.amount)).toBe(80);
    });
  });

  describe('Admin direct refund (no approval step)', () => {
    it('is safe to repeat with the same idempotency key', async () => {
      const t = setup();
      const c = t.addVerifiedCollection();
      const key = randomUUID();
      const a = await t.service.refund(c.id, { idempotencyKey: key, amount: '100', reason: 'x' }, ADMIN);
      const b = await t.service.refund(c.id, { idempotencyKey: key, amount: '100', reason: 'x' }, ADMIN);
      expect(b.id).toBe(a.id);
      expect(t.prisma.refund.rows).toHaveLength(1);
      await expect(t.service.refund(c.id, { idempotencyKey: key, amount: '200', reason: 'x' }, ADMIN)).rejects.toThrow('reused');
    });

    it('also refuses more than was paid', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('500.00');
      await expect(t.service.refund(c.id, { idempotencyKey: randomUUID(), amount: '501', reason: 'x' }, ADMIN)).rejects.toThrow('exceeds');
    });
  });

  describe('Step 4 – Sales report', () => {
    it('shows a completed refund as a negative row dated on the refund day', async () => {
      const t = setup();
      const c = t.addVerifiedCollection('1000.00');
      const req = await t.service.requestRefund(c.id, { amount: '300', reason: 'Damaged' }, CS);
      await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
      const rows = await t.service.sales();
      const refundRow = rows.find((r) => r.id === t.prisma.refund.rows[0].id)!;
      expect(refundRow.totalDailySales).toContain('-');
      expect(refundRow.totalDailySales).toContain('300.00');
      expect(refundRow.paymentRemarks).toBe('Damaged');
      expect(refundRow.date).toBe(t.prisma.refund.rows[0].businessDate);
    });
  });
});

describe('A refund closes the money (Daily Sales does not ask to collect it again)', () => {
  /** Adds what Daily Sales needs: a verified Post-Service record, the booking, and dispatch readiness. */
  function withDailySales(t: ReturnType<typeof setup>) {
    t.prisma.workOutcome = table([{
      bookingUuid: BOOKING, status: 'COMPLETED', arrivalTime: '08:00', issueReported: false, issueDetails: null,
      finalizedAt: new Date(), updatedAt: new Date(), finalizedBy: CS,
    }]);
    const record = {
      id: BOOKING, bookingId: 'B-001', bookingNo: 'BK-001', client: 'Juan', service: 'Lipat Bahay', date: '2026-11-20',
      status: 'Completed', version: 1, amount: '1000.00', downpayment: null, requestedPaymentMethod: 'GCash',
    };
    const bookings: any = { list: async () => [record], resolve: async () => record, get: async () => record, command: async () => ({}) };
    const dispatch: any = { postServiceReadyBookingUuids: async () => [BOOKING], snapshot: async () => ({}) };
    return new CollectionsService(t.prisma, bookings, dispatch);
  }

  it('still lists a booking that is genuinely unpaid, with its real balance', async () => {
    const t = setup();
    t.addVerifiedCollection('600.00');
    const drafts = await withDailySales(t).drafts();
    expect(drafts.map((d) => d.amount)).toEqual([400]);
  });

  it('does not list the refunded part of a fully paid booking as "to collect"', async () => {
    const t = setup();
    const c = t.addVerifiedCollection('1000.00');
    const req = await t.service.requestRefund(c.id, { amount: '250', reason: 'Damaged item' }, CS);
    await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
    const daily = withDailySales(t);
    expect(await daily.drafts()).toEqual([]);
    expect(await daily.eligibleBookings()).toEqual([]);
  });

  it('refuses to record the refunded amount as a new payment', async () => {
    const t = setup();
    const c = t.addVerifiedCollection('1000.00');
    const req = await t.service.requestRefund(c.id, { amount: '250', reason: 'Damaged item' }, CS);
    await t.service.decideApproval('refund', req.id, ADMIN, 'approve');
    await expect(withDailySales(t).create({
      idempotencyKey: randomUUID(), bookingId: BOOKING, amount: '250', method: 'Cash', reference: 'R-2',
    }, CS)).rejects.toThrow('already fully paid');
  });
});
