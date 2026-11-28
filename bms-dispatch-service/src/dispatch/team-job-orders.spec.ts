import { randomUUID } from 'node:crypto';
import { chargeLines, clockTime, teamStatus, TeamJobOrdersService } from './team-job-orders';

describe('clockTime', () => {
  it.each([
    ['8:30 AM', '08:30'], ['12:00 PM', '12:00'], ['12:15 AM', '00:15'], ['1 PM', '13:00'],
    ['08:30', '08:30'], ['17:05:00', '17:05'], ['08:00 - 10:00', '08:00'], ['9:00am', '09:00'],
  ])('reads %s as %s', (input, expected) => expect(clockTime(input)).toBe(expected));

  it.each([[null], [''], ['Morning'], ['25:00'], ['13:00 PM'], ['8']])('leaves %s empty', (input) => {
    expect(clockTime(input)).toBe('');
  });
});

describe('chargeLines', () => {
  it('splits the amount into the service and priced add-ons, adding up to the amount', () => {
    const lines = chargeLines({
      service: 'House Moving', amount: '5000.00',
      additionalServicesAvailed: [{ name: 'Bubble wrap', price: '₱500' }, { name: 'Free item', price: '0' }],
    });
    expect(lines).toEqual([{ label: 'House Moving', amount: 4500 }, { label: 'Bubble wrap', amount: 500 }]);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(5000);
  });

  it('shows one line when the add-ons alone exceed the amount', () => {
    expect(chargeLines({ service: 'Lipat', amount: 300, additionalServicesAvailed: [{ name: 'Crate', price: '900' }] }))
      .toEqual([{ label: 'Lipat', amount: 300 }]);
  });

  it('handles a booking without an amount or add-ons', () => {
    expect(chargeLines({ service: '', amount: null, additionalServicesAvailed: null })).toEqual([{ label: 'Service', amount: 0 }]);
  });
});

describe('teamStatus', () => {
  it('maps job order and booking state to the app status', () => {
    expect(teamStatus({ status: 'Pending' }, { status: 'Assigned' })).toBe('PENDING');
    expect(teamStatus({ status: 'Distributed' }, { status: 'Assigned' })).toBe('ONGOING');
    expect(teamStatus({ status: 'Distributed' }, { status: 'Completed' })).toBe('COMPLETED');
  });
});

/* ---------- mine() and teamBookings() against an in-memory dispatch database ---------- */

type Row = Record<string, any>;
const DRIVER_USER = randomUUID();
const HELPER_USER = randomUUID();
const OTHER_USER = randomUUID();
const DRIVER = randomUUID();
const HELPER = randomUUID();
const OTHER_DRIVER = randomUUID();
const VEHICLE = randomUUID();
const B1 = randomUUID(); // distributed, this driver + helper
const B2 = randomUUID(); // pending, this helper only, Subcon
const B3 = randomUUID(); // someone else's
const B4 = randomUUID(); // cancelled booking
const B5 = randomUUID(); // superseded job order
const B6 = randomUUID(); // assignment rejected

function where(row: Row, cond: Row): boolean {
  return Object.entries(cond).every(([key, value]) => {
    if (key === 'OR') return (value as Row[]).some((part) => where(row, part));
    if (value && typeof value === 'object' && 'has' in value) return (row[key] as string[]).includes(value.has);
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function setup(overrides: { fleetDown?: boolean } = {}) {
  const assignment = (bookingUuid: string, driverId: string | null, helperIds: string[], extra: Row = {}) => ({
    bookingUuid, driverId, helperIds, state: 'CONFIRMED', deliveryType: 'Inhouse', vehicleId: VEHICLE,
    garage: 'Marikina', dispatchTime: '7:30 AM', ...extra,
  });
  const order = (bookingUuid: string, no: string, extra: Row = {}) => ({
    bookingUuid, jobOrderNo: no, status: 'Pending', state: 'ACTIVE', serviceDate: '2026-12-01', truck: 'ABC 123', ...extra,
  });
  const tables: Record<string, Row[]> = {
    driver: [{ id: DRIVER, userId: DRIVER_USER, isActive: true, deletedAt: null }, { id: OTHER_DRIVER, userId: OTHER_USER, isActive: true, deletedAt: null }],
    helper: [{ id: HELPER, userId: HELPER_USER, isActive: true }],
    dispatchAssignment: [
      assignment(B1, DRIVER, [HELPER]),
      assignment(B2, null, [HELPER], { deliveryType: 'Subcon', vehicleId: null, garage: null }),
      assignment(B3, OTHER_DRIVER, []),
      assignment(B4, DRIVER, [HELPER]),
      assignment(B5, DRIVER, [HELPER]),
      assignment(B6, DRIVER, [HELPER], { state: 'REJECTED' }),
    ],
    dispatchJobOrder: [
      order(B1, 'JO-2026-0001', { status: 'Distributed' }), order(B2, 'JO-2026-0002'), order(B3, 'JO-2026-0003'),
      order(B4, 'JO-2026-0004'), order(B5, 'JO-2026-0005', { state: 'SUPERSEDED' }), order(B6, 'JO-2026-0006'),
    ],
  };
  const delegate = (name: string) => ({
    findFirst: async ({ where: cond }: Row) => tables[name].find((row) => where(row, cond)) ?? null,
    findMany: async ({ where: cond }: Row) => tables[name].filter((row) => where(row, cond)),
  });
  const prisma: any = Object.fromEntries(Object.keys(tables).map((name) => [name, delegate(name)]));
  const booking = (id: string, extra: Row = {}) => ({
    id, bookingId: 'WL-' + id.slice(0, 4), bookingNo: 'BK-' + id.slice(0, 4), client: 'Dela Cruz', service: 'House Moving',
    date: '2026-12-01', status: 'Assigned', version: 1, amount: '3000.00', preferredTime: '8:00 AM',
    pickupAddress: 'Pasig', deliveryAddress: 'Marikina', contact: '09171234567', hasInsurance: true, downpayment: '500.00',
    requestedPaymentMethod: 'GCash', ...extra,
  });
  const bookings: any = { list: async () => [booking(B1), booking(B2, { date: '2026-12-03' }), booking(B3), booking(B4, { status: 'Cancelled' }), booking(B5), booking(B6)] };
  const down = async () => { throw new Error('down'); };
  const fleet: any = overrides.fleetDown ? { drivers: down, helpers: down, vehicles: down } : {
    drivers: async () => [{ id: DRIVER, fullName: 'Ramon Cruz' }],
    helpers: async () => [{ id: HELPER, fullName: 'Mark Anthony' }],
    vehicles: async () => [{ id: VEHICLE, plateNumber: 'NBC 1234', alias: 'Truck 1' }],
  };
  return new TeamJobOrdersService(prisma, bookings, fleet);
}

describe('TeamJobOrdersService.mine', () => {
  it("returns only the driver's active, confirmed, not cancelled job orders", async () => {
    const { jobOrders } = await setup().mine(DRIVER_USER);
    expect(jobOrders.map((item) => item.id)).toEqual([B1]);
    expect(jobOrders[0]).toMatchObject({
      jobOrderNumber: 'JO-2026-0001', status: 'ONGOING', clientName: 'Dela Cruz', contactNumber: '09171234567',
      pickupTime: '08:00', dispatchTime: '07:30', driverId: DRIVER, driverName: 'Ramon Cruz',
      helperIds: [HELPER], helperNames: ['Mark Anthony'], vehicle: 'NBC 1234 Truck 1', insured: true,
      paymentMethod: 'GCash', downPayment: 500, postServiceFormSubmitted: false,
    });
  });

  it('returns the job orders a helper is on, newest service date first', async () => {
    const { jobOrders } = await setup().mine(HELPER_USER);
    expect(jobOrders.map((item) => item.id)).toEqual([B2, B1]);
    expect(jobOrders[0]).toMatchObject({ status: 'PENDING', driverName: 'Subcontractor', vehicle: 'Subcontractor truck' });
  });

  it('returns nothing for a login with no team member record or a bad id', async () => {
    expect(await setup().mine(randomUUID())).toEqual({ jobOrders: [] });
    expect(await setup().mine('not-a-uuid')).toEqual({ jobOrders: [] });
  });

  it('still returns the cards with placeholder names when Auth or VMMS is down', async () => {
    const { jobOrders } = await setup({ fleetDown: true }).mine(DRIVER_USER);
    expect(jobOrders[0]).toMatchObject({ driverName: 'Assigned driver', helperNames: ['Assigned helper'], vehicle: 'ABC 123' });
  });
});

describe('TeamJobOrdersService.teamBookings', () => {
  it('splits confirmed bookings by role', async () => {
    const driver = await setup().teamBookings(DRIVER_USER);
    expect(driver.driver.sort()).toEqual([B1, B4, B5].sort());
    expect(driver.helper).toEqual([]);
    const helper = await setup().teamBookings(HELPER_USER);
    expect(helper.driver).toEqual([]);
    expect(helper.helper.sort()).toEqual([B1, B2, B4, B5].sort());
  });
});
