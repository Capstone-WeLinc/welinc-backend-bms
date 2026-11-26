const test = require('node:test');
const assert = require('node:assert/strict');
const { ServiceUnavailableException } = require('@nestjs/common');
const { FleetService } = require('../dist/src/fleet/fleet.service.js');

const vehicleId = '11111111-1111-4111-8111-111111111111';
const driverId = '22222222-2222-4222-8222-222222222222';
const helperId = '33333333-3333-4333-8333-333333333333';
const helperUser = '55555555-5555-4555-8555-555555555555';
const newHelperUser = '66666666-6666-4666-8666-666666666666';
const person = (id, name, roles, extra = {}) => ({ id, name, email: `${id.slice(0, 4)}@example.test`, phone: '+639170000000', roles, temporaryRoles: [], isActive: true, deleted: false, erased: false, ...extra });
/** The Auth directory: everyone who holds a BMS role (spec bms/0012). */
const directory = (people = [person(helperUser, 'Sample Helper', ['HELPER'])]) => ({ lookup: async () => new Map(), roster: async () => people });

class FakeFleetProvider {
  constructor() {
    this.driver = {
      id: driverId, userId: '77777777-7777-4777-8777-777777777777', fullName: 'Demo Driver', status: 'Available',
      licenseNo: 'LIC-1', licenseType: 'Professional', contact: '09170000000', email: 'driver@example.test',
      address: 'Manila', emergencyName: 'Contact', emergencyContact: '09171111111',
    };
    this.vehicleStatus = 'AVAILABLE';
  }
  async garages() { return [{ id: 'garage-1', name: 'Test Garage' }]; }
  async vehicles() { return [{ id: vehicleId, plateNumber: 'TEST-001', alias: 'Unit test', type: '6W 14ft. with Lifter', status: this.vehicleStatus, requiredHelpers: 1, capacity: '1,000 kg' }]; }
  async drivers() { return [this.driver]; }
  async assignmentResources() {
    return {
      vehicle: { id: vehicleId, status: this.vehicleStatus, plateNumber: 'TEST-001', requiredHelpers: 1 },
      driver: { id: driverId, status: 'Available' },
    };
  }
  async updateDriver(id, body) { this.driver = { ...this.driver, ...body }; return this.driver; }
  async close() {}
}

const booking = {
  id: '44444444-4444-4444-8444-444444444444', bookingId: 'WL-TEST-1', bookingNo: 'BN-TEST-0001',
  client: 'Sample Client', service: 'Corporate Delivery', date: '2026-11-05', status: 'Assigned', version: 1,
  amount: 1200, pickupAddress: 'NCR pickup', deliveryAddress: 'NCR delivery', preferredTime: '08:00', deliveryLocation: 'NC — NCR to NCR',
};
function dependencies(provider) {
  return {
    provider,
    bookings: { list: async () => [booking] },
    prisma: {
      dispatchAssignment: { findMany: async ({ select, where }) => {
        if (where?.state === 'CONFIRMED') return [{
          id: booking.id, bookingUuid: booking.id, serviceDate: booking.date, dispatchTime: '08:00',
          vehicleId, driverId, helperIds: [helperId], state: 'CONFIRMED',
        }];
        return select?.vehicleId ? [{ vehicleId }] : select?.driverId ? [{ driverId }] : [];
      } },
      dispatchJobOrder: { findMany: async () => [{ bookingUuid: booking.id, jobOrderNo: 'JO-TEST-0001' }] },
      vehicleAvailabilitySampleVehicle: { findMany: async () => [] },
      helper: { findMany: async () => [{ id: helperId, userId: helperUser, isActive: true, crewStatus: 'Available' }] },
    },
  };
}

test('BMS fleet contract maps provider data and delegates BMS-only driver edits', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);

  assert.deepEqual(await service.garages(), [{ id: 'garage-1', name: 'Test Garage' }]);
  assert.equal((await service.vehicles())[0].isAssigned, true);
  assert.equal((await service.drivers())[0].status, 'On Duty');

  const driver = await service.updateDriver(driverId, {
    licenseNo: 'LIC-2', licenseType: 'Professional', licenseExpiry: '2028-10-01',
    address: 'Quezon City', status: 'Available', joinDate: '2026-09-01',
    emergencyName: 'New Contact', emergencyContact: '09173333333',
  });
  assert.equal(driver.licenseNo, 'LIC-2');
  assert.equal(driver.licenseExpiry, '2028-10-01');
  assert.equal(driver.address, 'Quezon City');
  assert.equal(driver.joinDate, '2026-09-01');
  assert.equal(driver.emergencyName, 'New Contact');
  assert.equal(driver.emergencyContact, '09173333333');
  assert.deepEqual(await service.checkAssignment(vehicleId, driverId, [helperId]), { plateNumber: 'TEST-001' });
});

test('a Subcon assignment checks only its helpers, with no truck or driver of ours', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  assert.deepEqual(await service.checkAssignment(null, null, [helperId]), { plateNumber: null });
  await assert.rejects(service.checkAssignment(null, null, []), /Required helpers are missing/);
  await assert.rejects(service.checkAssignment(vehicleId, null, [helperId]), /persisted fleet and crew IDs/);
});

test('name, email and contact number are edited in the portal, never in BMS', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  for (const field of ['fullName', 'email', 'contact']) {
    await assert.rejects(service.updateDriver(driverId, { [field]: 'x' }), /edited in the portal/);
    await assert.rejects(service.updateHelper(helperId, { [field]: 'x' }), /edited in the portal/);
  }
});

test('helpers are everyone with the Helper role in Auth, with the account name, email and phone', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const rows = [{ id: helperId, userId: helperUser, isActive: true, crewStatus: 'Available' }];
  let created;
  deps.prisma.helper.findMany = async ({ where }) => rows.filter((row) => where.userId.in.includes(row.userId));
  deps.prisma.helper.createMany = async ({ data }) => { created = data; rows.push({ id: '88888888-8888-4888-8888-888888888888', isActive: true, crewStatus: 'Available', ...data[0] }); };
  const people = [
    person(helperUser, 'Sample Helper', ['HELPER']),
    person(newHelperUser, 'Another Helper', ['HELPER']),
    person('99999999-9999-4999-8999-999999999999', 'Temporary Helper', ['HELPER'], { temporaryRoles: ['HELPER'] }),
    person('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'An Admin', ['ADMIN']),
  ];
  const service = new FleetService(deps.prisma, directory(people), deps.bookings, provider);
  const helpers = await service.helpers();
  assert.deepEqual(created, [{ userId: newHelperUser }], 'a new account gets its BMS row by itself');
  assert.deepEqual(helpers.map((helper) => helper.fullName), ['Another Helper', 'Sample Helper']);
  assert.equal(helpers[1].userId, helperUser);
  assert.equal(helpers[1].contact, '+639170000000');
  assert.equal(helpers[1].email, `${helperUser.slice(0, 4)}@example.test`);
  for (const gone of ['empId', 'initials', 'totalTrips']) assert.equal(gone in helpers[1], false);
});

test('a helper who lost the role in Auth cannot be assigned', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory([]), deps.bookings, provider);
  await assert.rejects(service.checkAssignment(vehicleId, driverId, [helperId]), /Helper is unavailable/);
});

test('crew edits allow a seeded helper to keep or clear optional fields', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  let saved;
  deps.prisma.helper.findUnique = async () => ({ id: helperId, userId: helperUser, isActive: true });
  deps.prisma.helper.update = async ({ data }) => { saved = data; };
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  await service.updateHelper(helperId, { emergencyName: '', emergencyContact: '', joinDate: '' });
  for (const field of ['emergencyName', 'emergencyContact', 'joinDate']) assert.equal(saved[field], null);
});

test('BMS fleet contract propagates provider outages instead of hiding them', async () => {
  const provider = new FakeFleetProvider();
  provider.assignmentResources = async () => { throw new ServiceUnavailableException('Fake fleet provider unavailable'); };
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  await assert.rejects(service.checkAssignment(vehicleId, driverId, [helperId]), ServiceUnavailableException);
});

test('vehicle availability contains only real fleet vehicles and embeds confirmed crew and assignment details', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  const rows = await service.vehicleAvailability();
  const real = rows.find((row) => row.id === vehicleId);
  assert.equal(real.driver.name, 'Demo Driver');
  assert.equal(real.helpers[0].name, 'Sample Helper');
  assert.equal(real.currentAssignment.jobOrderNumber, 'JO-TEST-0001');
  assert.equal(real.currentAssignment.bookingNumber, 'BN-TEST-0001');
  assert.equal(rows.length, 1);
  await assert.rejects(service.vehicleAvailabilityDetails('b1f00000-0000-4000-8000-000000000003'), /Vehicle not found/);
});

test('under maintenance and repair vehicles cannot be assigned', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, directory(), deps.bookings, provider);
  for (const status of ['UNDER_MAINTENANCE', 'UNDER_REPAIR']) {
    provider.vehicleStatus = status;
    await assert.rejects(service.checkAssignment(vehicleId, driverId, [helperId]), /Vehicle is unavailable/);
  }
});
