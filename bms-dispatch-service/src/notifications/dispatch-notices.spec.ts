import { randomUUID } from 'node:crypto';
import { assignedNotices, type CrewMember } from './dispatch-notices';
import { InternalDispatchController } from '../dispatch/internal-dispatch.controller';

const BOOKING = { bookingUuid: randomUUID(), bookingNo: 'BK-0146', client: 'Dela Cruz', date: '2026-12-05' };
const driver = (userId: string): CrewMember => ({ userId, role: 'DRIVER' });
const helper = (userId: string): CrewMember => ({ userId, role: 'HELPER' });
const RAMON = 'ramon';
const MARK = 'mark';
const JOSE = 'jose';
const LITO = 'lito';

function notices(crew: CrewMember[], previous: CrewMember[] | null, scheduleChanged: boolean) {
  return assignedNotices({
    booking: BOOKING, jobOrderNo: 'JO-2026-0001', dispatchTime: '07:30', commandId: 'cmd-1', actorId: 'ops',
    crew, previous, scheduleChanged,
  });
}
/** "kind:userId" for every team notice, sorted, so each case reads as a list of who gets what. */
const teamNotices = (items: ReturnType<typeof notices>) =>
  items.filter((item) => item.userId).map((item) => `${item.kind}:${item.userId}`).sort();

describe('assignedNotices (spec bms/0023)', () => {
  it('first assignment: everyone is assigned, and Operations hears the job order is ready', () => {
    const items = notices([driver(RAMON), helper(MARK)], null, false);
    expect(teamNotices(items)).toEqual(['crew.assigned:mark', 'crew.assigned:ramon']);
    expect(items.find((item) => item.kind === 'joborder.ready')).toMatchObject({ role: 'OPERATIONS' });
    expect(items.find((item) => item.userId === RAMON)?.title).toBe("You're assigned as the driver of a trip");
    expect(items.find((item) => item.userId === MARK)?.title).toBe("You're assigned as a helper on a trip");
  });

  it('rescheduled booking assigned to the same team: each person gets a schedule change only', () => {
    const items = notices([driver(RAMON), helper(MARK)], [driver(RAMON), helper(MARK)], true);
    expect(teamNotices(items)).toEqual(['crew.rescheduled:mark', 'crew.rescheduled:ramon']);
    expect(items.find((item) => item.kind === 'crew.rescheduled')).toMatchObject({
      title: 'Your trip has a new schedule', message: 'BK-0146 — 2026-12-05, dispatch at 07:30', bookingUuid: BOOKING.bookingUuid,
    });
  });

  it('one helper swapped: kept people get a schedule change, the dropped one is reassigned, the new one assigned', () => {
    const items = notices([driver(RAMON), helper(JOSE)], [driver(RAMON), helper(MARK)], true);
    expect(teamNotices(items)).toEqual(['crew.assigned:jose', 'crew.rescheduled:ramon', 'crew.unassigned:mark']);
    expect(items.find((item) => item.kind === 'crew.unassigned')?.title).toBe('Your trip was reassigned');
  });

  it('team changed without a new date or time: kept people hear nothing', () => {
    const items = notices([driver(RAMON), helper(JOSE)], [driver(RAMON), helper(MARK)], false);
    expect(teamNotices(items)).toEqual(['crew.assigned:jose', 'crew.unassigned:mark']);
  });

  it('only the garage or truck changed: nobody on the team is told', () => {
    expect(teamNotices(notices([driver(RAMON), helper(MARK)], [driver(RAMON), helper(MARK)], false))).toEqual([]);
  });

  it('a whole new team: the old one is reassigned, the new one assigned', () => {
    const items = notices([driver(LITO), helper(JOSE)], [driver(RAMON), helper(MARK)], true);
    expect(teamNotices(items)).toEqual(['crew.assigned:jose', 'crew.assigned:lito', 'crew.unassigned:mark', 'crew.unassigned:ramon']);
  });

  it('a person moved from helper to driver hears about the new role, not that they left', () => {
    const items = notices([driver(MARK), helper(JOSE)], [driver(RAMON), helper(MARK)], false);
    expect(teamNotices(items)).toEqual(['crew.assigned:jose', 'crew.assigned:mark', 'crew.unassigned:ramon']);
  });

  it('dedupe keys are per person and command, so a retried command sends nothing twice', () => {
    const items = notices([driver(RAMON), helper(MARK)], null, false);
    expect(new Set(items.map((item) => item.dedupeKey)).size).toBe(items.length);
    expect(notices([driver(RAMON), helper(MARK)], null, false).map((item) => item.dedupeKey)).toEqual(items.map((item) => item.dedupeKey));
  });
});

describe('approval effects on the team (spec bms/0023)', () => {
  const DRIVER_ID = randomUUID();
  const HELPER_ID = randomUUID();

  function setup() {
    const assignment = { bookingUuid: BOOKING.bookingUuid, state: 'CONFIRMED', driverId: DRIVER_ID, helperIds: [HELPER_ID] } as Record<string, any>;
    const queued: any[] = [];
    const tx: any = {
      approvalEventReceipt: { create: async () => ({}) },
      dispatchJobOrder: { findUnique: async () => ({ id: 'jo', status: 'Pending' }), update: async () => ({}), updateMany: async () => ({}) },
      dispatchAssignment: {
        findFirst: async ({ where }: any) => (assignment.state === where.state ? { ...assignment } : null),
        updateMany: async ({ data }: any) => { Object.assign(assignment, data); return { count: 1 }; },
      },
      driver: { findUnique: async () => ({ userId: 'ramon' }) },
      helper: { findMany: async () => [{ userId: 'mark' }] },
      notificationOutbox: { createMany: async ({ data }: any) => { queued.push(...data.map((row: any) => row.payload)); return { count: data.length }; } },
    };
    const prisma: any = { approvalEventReceipt: { findUnique: async () => null }, $transaction: (fn: any) => fn(tx) };
    process.env.BMS_INTERNAL_SERVICE_KEY = 'k'.repeat(32);
    const controller = new InternalDispatchController(prisma, {} as any, {} as any);
    return { controller, assignment, queued };
  }

  it('a reschedule remembers the team and tells it nothing yet', async () => {
    const { controller, assignment, queued } = setup();
    await controller.approvalEffect(randomUUID(), 'k'.repeat(32), { bookingUuid: BOOKING.bookingUuid, type: 'reschedule', bookingNo: 'BK-0146' });
    expect(assignment).toMatchObject({ state: 'REJECTED', releasedDriverId: DRIVER_ID, releasedHelperIds: [HELPER_ID] });
    expect(queued).toEqual([]);
  });

  it('a cancellation tells the team and remembers nothing', async () => {
    const { controller, assignment, queued } = setup();
    await controller.approvalEffect(randomUUID(), 'k'.repeat(32), { bookingUuid: BOOKING.bookingUuid, type: 'cancel', bookingNo: 'BK-0146' });
    expect(assignment).toMatchObject({ state: 'REJECTED', releasedDriverId: null, releasedHelperIds: [] });
    expect(queued.map((item) => `${item.kind}:${item.userId}`).sort()).toEqual(['crew.trip_changed:mark', 'crew.trip_changed:ramon']);
    expect(queued[0].title).toBe('Your trip was cancelled');
  });
});
