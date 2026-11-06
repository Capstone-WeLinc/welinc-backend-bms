const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBookingTiming, formatMinutes, ON_SITE_MINUTES, parseTimeMinutes, worstTiming } = require('../dist/src/dispatch/assignment-timing.js');
const { FleetService } = require('../dist/src/fleet/fleet.service.js');
const { DispatchService } = require('../dist/src/dispatch/dispatch.service.js');

const booking = (bookingNo, pickupTime, pickupAddress = `${bookingNo} pickup`, deliveryAddress = `${bookingNo} dropoff`) => ({ bookingNo, pickupTime, pickupAddress, deliveryAddress });

// Drive between stops is 40 minutes and to the next pickup is 20, so the first job is clear at start + 180.
function travelTable(calls = []) {
  return async (from, to) => {
    calls.push(`${from}>${to}`);
    return from.endsWith('dropoff') ? 20 : 40;
  };
}

test('on-site allowance is the agreed two hours', () => {
  assert.equal(ON_SITE_MINUTES, 120);
});

test('reads both stored time formats', () => {
  assert.equal(parseTimeMinutes('14:00'), 840);
  assert.equal(parseTimeMinutes('2:00 PM'), 840);
  assert.equal(parseTimeMinutes('12:00 AM'), 0);
  assert.equal(parseTimeMinutes('12:30 PM'), 750);
  assert.equal(parseTimeMinutes('08:00:00'), 480);
  assert.equal(parseTimeMinutes('25:00'), null);
  assert.equal(parseTimeMinutes('13:00 PM'), null);
  assert.equal(parseTimeMinutes(''), null);
  assert.equal(parseTimeMinutes(null), null);
  assert.equal(formatMinutes(780), '1:00 PM');
  assert.equal(formatMinutes(0), '12:00 AM');
});

test('allows a second booking when the truck can arrive exactly on time', async () => {
  // 8:00 + 40 + 120 + 20 = 11:00
  const result = await checkBookingTiming(booking('LATER', '11:00 AM'), booking('EARLY', '8:00 AM'), travelTable());
  assert.deepEqual(result, { status: 'available' });
});

test('blocks a second booking one minute too early and says when the truck can arrive', async () => {
  const result = await checkBookingTiming(booking('LATER', '10:59 AM'), booking('EARLY', '8:00 AM'), travelTable());
  assert.equal(result.status, 'blocked');
  assert.match(result.message, /EARLY/);
  assert.match(result.message, /11:00 AM/);
});

test('also blocks a booking placed before an existing one when it would make that one late', async () => {
  const result = await checkBookingTiming(booking('NEW', '8:00 AM'), booking('EXISTING', '10:00 AM'), travelTable());
  assert.equal(result.status, 'blocked');
  assert.match(result.message, /Has EXISTING at 10:00 AM/);
  assert.match(result.message, /11:00 AM/);
});

test('distance decides: the same times can pass for near stops and fail for far ones', async () => {
  const near = await checkBookingTiming(booking('LATER', '12:00 PM'), booking('EARLY', '8:00 AM'), async () => 30);
  const far = await checkBookingTiming(booking('LATER', '12:00 PM'), booking('EARLY', '8:00 AM'), async () => 90);
  assert.equal(near.status, 'available');
  assert.equal(far.status, 'blocked');
});

test('uses the earlier job route and the drive from its drop-off to the later pickup', async () => {
  const calls = [];
  await checkBookingTiming(booking('LATER', '1:00 PM'), booking('EARLY', '8:00 AM'), travelTable(calls));
  assert.deepEqual(calls, ['EARLY pickup>EARLY dropoff', 'EARLY dropoff>LATER pickup']);
});

test('skips paid route lookups when the on-site time alone cannot fit', async () => {
  const calls = [];
  const result = await checkBookingTiming(booking('LATER', '9:59 AM'), booking('EARLY', '8:00 AM'), travelTable(calls));
  assert.equal(result.status, 'blocked');
  assert.equal(calls.length, 0);
});

test('identical pickup times are blocked', async () => {
  assert.equal((await checkBookingTiming(booking('A', '8:00 AM'), booking('B', '08:00'), travelTable())).status, 'blocked');
});

test('a failed route lookup asks Operations to decide instead of guessing', async () => {
  const result = await checkBookingTiming(booking('LATER', '1:00 PM'), booking('EARLY', '8:00 AM'), async () => null);
  assert.equal(result.status, 'unverified');
  assert.match(result.message, /EARLY/);
});

test('missing pickup times or addresses are unverified, not assumed safe', async () => {
  assert.equal((await checkBookingTiming(booking('A', null), booking('B', '8:00 AM'), travelTable())).status, 'unverified');
  assert.equal((await checkBookingTiming(booking('LATER', '1:00 PM'), booking('EARLY', '8:00 AM', null), travelTable())).status, 'unverified');
});

test('the worst result across a day wins', () => {
  const available = { status: 'available' };
  const unverified = { status: 'unverified', message: 'check' };
  const blocked = { status: 'blocked', message: 'no' };
  assert.equal(worstTiming([available, unverified, blocked]).status, 'blocked');
  assert.equal(worstTiming([available, unverified]).status, 'unverified');
  assert.equal(worstTiming([available]).status, 'available');
  assert.equal(worstTiming([]).status, 'available');
});

const IDS = {
  target: '44444444-4444-4444-8444-444444444444', other: '55555555-5555-4555-8555-555555555555',
  truck: '11111111-1111-4111-8111-111111111111', otherTruck: '66666666-6666-4666-8666-666666666666',
  driver: '22222222-2222-4222-8222-222222222222', otherDriver: '77777777-7777-4777-8777-777777777777',
  helper: '33333333-3333-4333-8333-333333333333', otherHelper: '88888888-8888-4888-8888-888888888888',
  actor: '99999999-9999-4999-8999-999999999999',
};

// Runs the real assign() with an existing booking at 8:00 AM using the given truck and crew.
function assignScenario({ pickupTime, routeMinutes = 40, routeFails = false }) {
  const record = (id, bookingNo, preferredTime) => ({
    id, bookingId: bookingNo, bookingNo, date: '2026-12-01', preferredTime,
    pickupAddress: `${bookingNo} pickup`, deliveryAddress: `${bookingNo} dropoff`,
  });
  const records = { [IDS.target]: record(IDS.target, 'NEW', pickupTime), [IDS.other]: record(IDS.other, 'EXISTING', '8:00 AM') };
  const lookups = [];
  const bookings = {
    get: async (id) => records[id],
    route: async (from, to) => {
      lookups.push(`${from}>${to}`);
      if (routeFails) throw new Error('Google unavailable');
      return { durationMin: routeMinutes };
    },
  };
  const queries = [];
  const prisma = { dispatchAssignment: { findMany: async ({ where }) => {
    queries.push(where);
    return [{ bookingUuid: IDS.other, vehicleId: IDS.truck, driverId: IDS.driver, helperIds: [IDS.helper], state: 'CONFIRMED' }];
  } } };
  const service = new DispatchService(prisma, bookings, {});
  let confirmed = false;
  service.validateAssignment = async (_id, input) => input;
  service.confirmAssignment = async () => { confirmed = true; return { ok: true }; };
  return { service, lookups, queries, wasConfirmed: () => confirmed };
}
const sameCrew = { vehicleId: IDS.truck, driverId: IDS.driver, helperIds: [IDS.helper] };

test('assign refuses a truck that cannot make it, even if the dialog is bypassed', async () => {
  const run = assignScenario({ pickupTime: '9:00 AM' });
  await assert.rejects(run.service.assign(IDS.target, sameCrew, IDS.actor), /EXISTING/);
  assert.equal(run.wasConfirmed(), false);
});

test('assign refuses a too-tight booking even when timing was confirmed by hand', async () => {
  const run = assignScenario({ pickupTime: '9:00 AM' });
  await assert.rejects(run.service.assign(IDS.target, { ...sameCrew, travelConfirmed: true }, IDS.actor), /EXISTING/);
  assert.equal(run.wasConfirmed(), false);
});

test('assign allows double-booking the same truck and crew when the times and distance work', async () => {
  const run = assignScenario({ pickupTime: '1:00 PM' });
  await run.service.assign(IDS.target, sameCrew, IDS.actor);
  assert.equal(run.wasConfirmed(), true);
  assert.deepEqual(run.lookups, ['EXISTING pickup>EXISTING dropoff', 'EXISTING dropoff>NEW pickup']);
});

test('distance alone can refuse the same pickup times', async () => {
  const run = assignScenario({ pickupTime: '1:00 PM', routeMinutes: 120 });
  await assert.rejects(run.service.assign(IDS.target, sameCrew, IDS.actor), /EXISTING/);
  assert.equal(run.wasConfirmed(), false);
});

test('a different truck and crew are not held back by the other booking', async () => {
  const run = assignScenario({ pickupTime: '8:00 AM' });
  await run.service.assign(IDS.target, { vehicleId: IDS.otherTruck, driverId: IDS.otherDriver, helperIds: [IDS.otherHelper] }, IDS.actor);
  assert.equal(run.wasConfirmed(), true);
});

test('a busy driver blocks the assignment even with a free truck, and the same for a helper', async () => {
  const byDriver = assignScenario({ pickupTime: '9:00 AM' });
  await assert.rejects(byDriver.service.assign(IDS.target, { vehicleId: IDS.otherTruck, driverId: IDS.driver, helperIds: [IDS.otherHelper] }, IDS.actor), /EXISTING/);
  const byHelper = assignScenario({ pickupTime: '9:00 AM' });
  await assert.rejects(byHelper.service.assign(IDS.target, { vehicleId: IDS.otherTruck, driverId: IDS.otherDriver, helperIds: [IDS.helper] }, IDS.actor), /EXISTING/);
});

test('when Google fails, assign needs Operations to confirm, then lets it through', async () => {
  const unconfirmed = assignScenario({ pickupTime: '1:00 PM', routeFails: true });
  await assert.rejects(unconfirmed.service.assign(IDS.target, sameCrew, IDS.actor), /Confirm the timing/);
  assert.equal(unconfirmed.wasConfirmed(), false);
  const confirmed = assignScenario({ pickupTime: '1:00 PM', routeFails: true });
  await confirmed.service.assign(IDS.target, { ...sameCrew, travelConfirmed: true }, IDS.actor);
  assert.equal(confirmed.wasConfirmed(), true);
});

test('only bookings on the same date are compared', async () => {
  const run = assignScenario({ pickupTime: '1:00 PM' });
  await run.service.resourceTiming(IDS.target);
  assert.equal(run.queries[0].serviceDate, '2026-12-01');
  assert.deepEqual(run.queries[0].bookingUuid, { not: IDS.target });
});

test('travel lookups are reused so repeat checks do not pay Google again', async () => {
  const run = assignScenario({ pickupTime: '1:00 PM' });
  await run.service.resourceTiming(IDS.target);
  await run.service.resourceTiming(IDS.target);
  assert.equal(run.lookups.length, 2);
});

test('a sample that joined the real fleet appears once, with no made-up crew', async () => {
  const sample = (plateNumber) => ({
    id: `sample-${plateNumber}`, plateNumber, alias: 'Unit', brand: null, model: null, truckTypeId: '10ft. Closed Van', capacityKg: 1500,
    dimensions: '', requiredHelpersMin: 1, requiredHelpersMax: 1, status: 'assigned', crew: [{ id: 'x', name: 'Made Up', role: 'Driver' }],
    currentAssignment: { bookingNumber: 'SAMPLE' }, upcomingSchedule: [],
  });
  const prisma = {
    dispatchAssignment: { findMany: async () => [] },
    dispatchJobOrder: { findMany: async () => [] },
    helper: { findMany: async () => [] },
    vehicleAvailabilitySampleVehicle: { findMany: async () => [sample('NCF-7716'), sample('ONLY-SAMPLE')] },
  };
  const provider = {
    vehicles: async () => [{ id: 'real-id', plateNumber: 'NCF-7716', status: 'AVAILABLE', capacity: '0', requiredHelpers: 2 }],
    drivers: async () => [],
  };
  const rows = await new FleetService(prisma, { list: async () => [] }, provider).vehicleAvailability();
  assert.deepEqual(rows.map((row) => row.plateNumber), ['NCF-7716', 'ONLY-SAMPLE']);
  assert.equal(rows[0].id, 'real-id');
  assert.equal(rows[0].driver, null);
  assert.equal(rows[0].currentAssignment, null);
  assert.equal(rows[0].capacityKg, null);
});

test('trucks and crew only show as busy on the date they are booked', async () => {
  const vehicleId = '11111111-1111-4111-8111-111111111111';
  const driverId = '22222222-2222-4222-8222-222222222222';
  const helperId = '33333333-3333-4333-8333-333333333333';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const run = async (serviceDate) => {
    const rows = [{ serviceDate, vehicleId, driverId, helperIds: [helperId], state: 'CONFIRMED' }];
    const prisma = {
      dispatchAssignment: { findMany: async ({ where }) => rows.filter((row) => !where.serviceDate || row.serviceDate === where.serviceDate) },
      helper: { findMany: async () => [{ id: helperId, empId: 'HLP-001', name: 'Helper', initials: 'H', crewStatus: 'Available' }] },
    };
    const provider = {
      vehicles: async () => [{ id: vehicleId, status: 'AVAILABLE' }],
      drivers: async () => [{ id: driverId, status: 'Available' }],
    };
    const service = new FleetService(prisma, {}, provider);
    return { vehicle: (await service.vehicles())[0].isAssigned, driver: (await service.drivers())[0].status, helper: (await service.helpers())[0].status };
  };
  assert.deepEqual(await run(today), { vehicle: true, driver: 'On Duty', helper: 'On Duty' });
  assert.deepEqual(await run('2020-01-01'), { vehicle: false, driver: 'Available', helper: 'Available' });
  assert.deepEqual(await run('2099-12-31'), { vehicle: false, driver: 'Available', helper: 'Available' });
});
