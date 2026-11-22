import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CrewLeaveService, manilaToday } from './crew-leave.service';

/* ---------- In-memory stand-in for the dispatch database ---------- */

type Row = Record<string, any>;

function test(value: any, cond: any): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
    if ('in' in cond && !cond.in.includes(value)) return false;
    if ('lte' in cond && !(value <= cond.lte)) return false;
    if ('gte' in cond && !(value >= cond.gte)) return false;
    if ('hasSome' in cond && !(Array.isArray(value) && value.some((v: any) => cond.hasSome.includes(v)))) return false;
    return true;
  }
  return value === cond;
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) =>
    key === 'OR' ? (cond as Row[]).some((part) => matches(row, part)) : test(row[key], cond));
}

function table(rows: Row[], defaults: () => Row = () => ({})) {
  const find = (where: Row) => rows.find((r) => matches(r, where)) ?? null;
  return {
    rows,
    findFirst: async ({ where }: any) => find(where),
    findUnique: async ({ where, include }: any) => {
      const row = find(where);
      if (row && include?.events) return { ...row, events: db.crewLeaveEvent.rows.filter((e) => e.requestId === row.id) };
      return row;
    },
    findUniqueOrThrow: async ({ where }: any) => { const row = find(where); if (!row) throw new Error('not found'); return row; },
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: any) => { const row = { id: randomUUID(), ...defaults(), ...data }; rows.push(row); return row; },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length };
    },
  };
}

let db: any;
const DRIVER = randomUUID();
const HELPER = randomUUID();
// The logins linked to those crew records (drivers.user_id / helpers.user_id).
const DRIVER_USER = randomUUID();
const HELPER_USER = randomUUID();
const ADMIN = randomUUID();
const today = manilaToday();
const plus = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function setup() {
  db = {
    driver: table([{ id: DRIVER, userId: DRIVER_USER, empId: 'DRV-001', name: 'Ramon Cruz', isActive: true, deletedAt: null }]),
    helper: table([{ id: HELPER, userId: HELPER_USER, empId: 'HLP-001', name: 'Mark Anthony', isActive: true }]),
    crewLeaveRequest: table([], () => ({ status: 'Requested', requestedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null })),
    crewLeaveEvent: table([], () => ({ createdAt: new Date() })),
    dispatchAssignment: table([]),
    $executeRaw: async () => 0,
  };
  db.$transaction = async (fn: (tx: any) => any) => fn(db);
  const bookings: any = { get: async (id: string) => ({ id, bookingNo: 'BK-' + id.slice(0, 4), client: 'Client' }) };
  return new CrewLeaveService(db, bookings);
}

const leave = (extra: Row = {}) => ({ kind: 'LEAVE', startDate: plus(1), endDate: plus(2), reason: 'Family event', ...extra });
const emergency = (reason = 'Sick') => ({ kind: 'EMERGENCY', reason });

describe('Crew leave', () => {
  describe('Filing (the crew member, for themselves)', () => {
    it('a driver files a planned leave for their own record that waits for Admin', async () => {
      const s = setup();
      const r = await s.fileSelf(leave(), DRIVER_USER);
      expect(r).toEqual(expect.objectContaining({
        status: 'Requested', kind: 'LEAVE', crewType: 'DRIVER', crewId: DRIVER, crewName: 'Ramon Cruz', crewEmpId: 'DRV-001', requestedBy: DRIVER_USER,
      }));
      expect(db.crewLeaveEvent.rows).toEqual([expect.objectContaining({ action: 'filed', actorId: DRIVER_USER })]);
      expect((await s.onLeave(plus(1))).has(DRIVER)).toBe(false);
    });

    it('a helper files an emergency that starts today and is in effect immediately', async () => {
      const s = setup();
      const r = await s.fileSelf(emergency('Hospital'), HELPER_USER);
      expect(r).toEqual(expect.objectContaining({ crewType: 'HELPER', crewId: HELPER, startDate: today, endDate: today }));
      expect((await s.onLeave(today)).has(HELPER)).toBe(true);
    });

    it('ignores any crew named in the body and always files for the signed-in person', async () => {
      const s = setup();
      const r = await s.fileSelf(leave({ crewType: 'HELPER', crewId: HELPER }), DRIVER_USER);
      expect(r.crewId).toBe(DRIVER);
    });

    it('refuses a login that is not linked to an active driver or helper', async () => {
      const s = setup();
      await expect(s.fileSelf(leave(), randomUUID())).rejects.toThrow(ForbiddenException);
      await expect(s.fileSelf(leave(), 'not-a-uuid')).rejects.toThrow(ForbiddenException);
      db.driver.rows[0].isActive = false;
      await expect(s.fileSelf(leave(), DRIVER_USER)).rejects.toThrow('not linked');
    });

    it('refuses an emergency dated in the future', async () => {
      const s = setup();
      await expect(s.fileSelf(leave({ kind: 'EMERGENCY', startDate: plus(1) }), DRIVER_USER)).rejects.toThrow('starts today');
    });

    it.each([
      ['no reason', { reason: '  ' }],
      ['a past start', { startDate: plus(-1) }],
      ['end before start', { startDate: plus(3), endDate: plus(2) }],
      ['more than 30 days', { startDate: plus(1), endDate: plus(31) }],
      ['a bad date', { startDate: '2026-02-30' }],
      ['an unknown kind', { kind: 'HOLIDAY' }],
    ])('refuses %s', async (_label, extra) => {
      const s = setup();
      await expect(s.fileSelf(leave(extra), DRIVER_USER)).rejects.toThrow(BadRequestException);
    });

    it('accepts exactly 30 days', async () => {
      const s = setup();
      await expect(s.fileSelf(leave({ startDate: plus(1), endDate: plus(30) }), DRIVER_USER)).resolves.toBeDefined();
    });

    it('refuses overlapping requests for the same person, but not for someone else', async () => {
      const s = setup();
      await s.fileSelf(leave({ startDate: plus(1), endDate: plus(5) }), DRIVER_USER);
      await expect(s.fileSelf(leave({ startDate: plus(5), endDate: plus(6) }), DRIVER_USER)).rejects.toThrow(ConflictException);
      await expect(s.fileSelf(leave({ startDate: plus(6), endDate: plus(7) }), DRIVER_USER)).resolves.toBeDefined();
      await expect(s.fileSelf(leave(), HELPER_USER)).resolves.toBeDefined();
    });
  });

  describe('Own requests', () => {
    it('lists only the signed-in crew member\'s requests', async () => {
      const s = setup();
      const mine = await s.fileSelf(leave(), DRIVER_USER);
      await s.fileSelf(leave(), HELPER_USER);
      expect((await s.selfList(DRIVER_USER)).map((r: Row) => r.id)).toEqual([mine.id]);
      await expect(s.selfList(randomUUID())).rejects.toThrow(ForbiddenException);
    });

    it('shows a named history of your own request, and refuses anyone else\'s', async () => {
      const s = setup();
      const directory: any = { lookup: async () => new Map([[DRIVER_USER, { name: 'Ramon Cruz' }], [ADMIN, { name: 'Bernardo Mendoza' }]]) };
      const named = new CrewLeaveService(db, { get: async () => ({}) } as any, directory);
      const r = await named.fileSelf(leave(), DRIVER_USER);
      await named.decide(r.id, ADMIN, 'reject', 'Busy week');
      const view = await named.selfDetail(r.id, DRIVER_USER);
      expect(view).toEqual(expect.objectContaining({ status: 'Rejected', submittedByName: 'Ramon Cruz', decidedByName: 'Bernardo Mendoza' }));
      expect(view.audit.map((e) => `${e.action}:${e.actorName}`)).toEqual(['filed:Ramon Cruz', 'rejected:Bernardo Mendoza']);
      await expect(named.selfDetail(r.id, HELPER_USER)).rejects.toThrow(ForbiddenException);
      await expect(s.selfDetail(r.id, DRIVER_USER)).resolves.toEqual(expect.objectContaining({ submittedByName: 'Unknown user' }));
    });
  });

  describe('Withdraw', () => {
    it('only the crew member can withdraw their own request, only while waiting, and an emergency ends at once', async () => {
      const s = setup();
      const r = await s.fileSelf(emergency(), DRIVER_USER);
      await expect(s.withdrawSelf(r.id, HELPER_USER)).rejects.toThrow(ForbiddenException);
      await expect(s.withdrawSelf(r.id, randomUUID())).rejects.toThrow(ForbiddenException);
      const w = await s.withdrawSelf(r.id, DRIVER_USER);
      expect(w.status).toBe('Withdrawn');
      expect((await s.onLeave(today)).has(DRIVER)).toBe(false);
      await expect(s.withdrawSelf(r.id, DRIVER_USER)).rejects.toThrow('Only waiting');
    });

    it('a withdrawn request no longer blocks a new one for the same dates', async () => {
      const s = setup();
      const r = await s.fileSelf(leave(), DRIVER_USER);
      await s.withdrawSelf(r.id, DRIVER_USER);
      await expect(s.fileSelf(leave(), DRIVER_USER)).resolves.toBeDefined();
    });
  });

  describe('Admin decision', () => {
    it('approving a leave puts the person on leave for those dates only', async () => {
      const s = setup();
      const r = await s.fileSelf(leave({ startDate: plus(1), endDate: plus(2) }), DRIVER_USER);
      const d = await s.decide(r.id, ADMIN, 'approve');
      expect(d.status).toBe('Approved');
      expect((await s.onLeave(plus(1))).has(DRIVER)).toBe(true);
      expect((await s.onLeave(plus(2))).has(DRIVER)).toBe(true);
      expect((await s.onLeave(plus(3))).has(DRIVER)).toBe(false);
      expect((await s.onLeave(today)).has(DRIVER)).toBe(false);
      expect(db.crewLeaveEvent.rows.map((e: Row) => e.action)).toEqual(['filed', 'approved']);
    });

    it('confirming an emergency is recorded as "confirmed"', async () => {
      const s = setup();
      const r = await s.fileSelf(emergency(), DRIVER_USER);
      await s.decide(r.id, ADMIN, 'approve');
      expect(db.crewLeaveEvent.rows.at(-1).action).toBe('confirmed');
      expect((await s.onLeave(today)).has(DRIVER)).toBe(true);
    });

    it('rejecting needs a reason, and a rejected emergency returns the person to available', async () => {
      const s = setup();
      const r = await s.fileSelf(emergency(), DRIVER_USER);
      await expect(s.decide(r.id, ADMIN, 'reject', '')).rejects.toThrow(BadRequestException);
      const d = await s.decide(r.id, ADMIN, 'reject', 'No proof');
      expect(d).toEqual(expect.objectContaining({ status: 'Rejected', decisionReason: 'No proof' }));
      expect((await s.onLeave(today)).has(DRIVER)).toBe(false);
    });

    it('the filer cannot decide their own request, and nobody can decide twice', async () => {
      const s = setup();
      const r = await s.fileSelf(leave(), DRIVER_USER);
      await expect(s.decide(r.id, DRIVER_USER, 'approve')).rejects.toThrow('your own');
      await s.decide(r.id, ADMIN, 'approve');
      await expect(s.decide(r.id, randomUUID(), 'reject', 'x')).rejects.toThrow('already been decided');
    });

    it('cannot approve once the dates have passed', async () => {
      const s = setup();
      const r = await s.fileSelf(leave(), DRIVER_USER);
      db.crewLeaveRequest.rows[0].startDate = plus(-3);
      db.crewLeaveRequest.rows[0].endDate = plus(-2);
      await expect(s.decide(r.id, ADMIN, 'approve')).rejects.toThrow('already passed');
    });
  });

  describe('Approvals queue', () => {
    it('lists waiting requests and approved ones in the shape the Approvals page uses', async () => {
      const s = setup();
      const a = await s.fileSelf(leave(), DRIVER_USER);
      const b = await s.fileSelf(emergency('Flood'), HELPER_USER);
      const waiting = (await s.approvalItems()).items;
      expect(waiting).toHaveLength(2);
      expect(waiting.find((i) => i.id === b.id)).toEqual(expect.objectContaining({
        type: 'crew', subtype: 'emergency', bookingNo: 'HLP-001', client: 'Mark Anthony (Helper)', amount: null, status: 'Requested', submittedBy: HELPER_USER,
      }));
      await s.decide(a.id, ADMIN, 'approve');
      expect((await s.approvalItems()).items.map((i) => i.id)).toEqual([b.id]);
      expect((await s.approvalItems('approved')).items.map((i) => i.id)).toEqual([a.id]);
    });

    it('the detail view includes the history and any affected trips', async () => {
      const s = setup();
      const bookingUuid = randomUUID();
      db.dispatchAssignment.rows.push({ bookingUuid, serviceDate: plus(1), dispatchTime: '08:00', state: 'CONFIRMED', driverId: DRIVER, helperIds: [] });
      const r = await s.fileSelf(leave(), DRIVER_USER);
      const detail = await s.approvalDetail(r.id);
      expect(detail.audit.map((e) => e.action)).toEqual(['filed']);
      expect(detail.affectedTrips).toEqual([expect.objectContaining({ bookingUuid, serviceDate: plus(1), crewName: 'Ramon Cruz' })]);
    });
  });

  describe('Trips and assignments', () => {
    it('flags trips whose crew is on leave that day, and stops flagging after reassignment', async () => {
      const s = setup();
      const trip = { bookingUuid: randomUUID(), serviceDate: plus(1), dispatchTime: '08:00', state: 'CONFIRMED', driverId: randomUUID(), helperIds: [HELPER] };
      db.dispatchAssignment.rows.push(trip, { bookingUuid: randomUUID(), serviceDate: plus(5), dispatchTime: '08:00', state: 'CONFIRMED', driverId: randomUUID(), helperIds: [HELPER] });
      const r = await s.fileSelf(leave(), HELPER_USER);
      expect(await s.conflicts()).toHaveLength(0); // a waiting leave isn't in effect yet
      await s.decide(r.id, ADMIN, 'approve');
      const flagged = await s.conflicts();
      expect(flagged).toEqual([expect.objectContaining({ bookingUuid: trip.bookingUuid, crewName: 'Mark Anthony', bookingNo: expect.any(String) })]);
      trip.helperIds = [randomUUID()];
      expect(await s.conflicts()).toHaveLength(0);
    });

    it('blocks assigning a driver or helper who is on leave on the service date', async () => {
      const s = setup();
      const r = await s.fileSelf(leave({ startDate: plus(1), endDate: plus(1) }), HELPER_USER);
      await expect(s.assertAvailable(plus(1), DRIVER, [HELPER])).resolves.toBeUndefined(); // still waiting
      await s.decide(r.id, ADMIN, 'approve');
      await expect(s.assertAvailable(plus(1), DRIVER, [HELPER])).rejects.toThrow('Mark Anthony is on leave');
      await expect(s.assertAvailable(plus(2), DRIVER, [HELPER])).resolves.toBeUndefined();
      await s.fileSelf(emergency(), DRIVER_USER);
      await expect(s.assertAvailable(today, DRIVER, [])).rejects.toThrow('Ramon Cruz is on emergency leave');
    });

    it('lists leave in effect from a date onward for the pickers', async () => {
      const s = setup();
      const a = await s.fileSelf(leave({ startDate: plus(1), endDate: plus(2) }), DRIVER_USER);
      await s.fileSelf(leave({ startDate: plus(3), endDate: plus(4) }), HELPER_USER);
      await s.decide(a.id, ADMIN, 'approve');
      expect((await s.active()).map((x) => x.crewId)).toEqual([DRIVER]);
      expect(await s.active(plus(3))).toEqual([]);
    });
  });
});
