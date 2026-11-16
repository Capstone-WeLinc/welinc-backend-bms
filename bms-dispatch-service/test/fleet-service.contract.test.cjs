const test = require('node:test');
const assert = require('node:assert/strict');
const { ServiceUnavailableException } = require('@nestjs/common');
const { FleetService } = require('../dist/src/fleet/fleet.service.js');

const vehicleId = '11111111-1111-4111-8111-111111111111';
const driverId = '22222222-2222-4222-8222-222222222222';
const helperId = '33333333-3333-4333-8333-333333333333';

class FakeFleetProvider {
  constructor() {
    this.driver = {
      id: driverId, empId: 'DRV-FAKE1', fullName: 'Demo Driver', initials: 'DD', status: 'Available',
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
  async createDriver(body) { this.driver = { ...this.driver, ...body }; return this.driver; }
  async updateDriver(id, body) { this.driver = { ...this.driver, ...body }; return this.driver; }
  async removeDriver() {}
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
      helper: { findMany: async () => [{ id: helperId, empId: 'HLP-001', name: 'Sample Helper', initials: 'SH', isActive: true, crewStatus: 'Available' }] },
    },
  };
}

test('BMS fleet contract maps provider data and delegates full driver edits', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, { lookup: async()=>new Map() }, deps.bookings, provider);

  assert.deepEqual(await service.garages(), [{ id: 'garage-1', name: 'Test Garage' }]);
  assert.equal((await service.vehicles())[0].isAssigned, true);
  assert.equal((await service.drivers())[0].status, 'On Duty');

  const driver = await service.updateDriver(driverId, {
    fullName: 'Updated Driver', licenseNo: 'LIC-2', licenseType: 'Professional',
    licenseExpiry: '2028-10-01', contact: '09172222222', email: 'updated@example.test',
    address: 'Quezon City', status: 'Available', joinDate: '2026-09-01',
    emergencyName: 'New Contact', emergencyContact: '09173333333',
  });
  assert.equal(driver.fullName, 'Updated Driver');
  assert.equal(driver.licenseNo, 'LIC-2');
  assert.equal(driver.licenseExpiry, '2028-10-01');
  assert.equal(driver.licenseType, 'Professional');
  assert.equal(driver.contact, '09172222222');
  assert.equal(driver.email, 'updated@example.test');
  assert.equal(driver.address, 'Quezon City');
  assert.equal(driver.joinDate, '2026-09-01');
  assert.equal(driver.emergencyName, 'New Contact');
  assert.equal(driver.emergencyContact, '09173333333');
  assert.deepEqual(await service.checkAssignment(vehicleId, driverId, [helperId]), { plateNumber: 'TEST-001' });
});

test('crew edits allow a seeded helper to keep or clear optional contact fields', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  let saved;
  deps.prisma.helper.findUnique = async () => ({ id: helperId, isActive: true });
  deps.prisma.helper.update = async ({ data }) => { saved = data; };
  const service = new FleetService(deps.prisma, { lookup: async () => new Map() }, deps.bookings, provider);
  await service.updateHelper(helperId, { fullName: 'Sample Helper', contact: '', email: '', emergencyName: '', emergencyContact: '', joinDate: '' });
  assert.equal(saved.name, 'Sample Helper');
  for (const field of ['contact', 'email', 'emergencyName', 'emergencyContact', 'joinDate']) assert.equal(saved[field], null);
});

test('BMS fleet contract propagates provider outages instead of hiding them', async () => {
  const provider = new FakeFleetProvider();
  provider.assignmentResources = async () => { throw new ServiceUnavailableException('Fake fleet provider unavailable'); };
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, { lookup: async()=>new Map() }, deps.bookings, provider);
  await assert.rejects(service.checkAssignment(vehicleId, driverId, [helperId]), ServiceUnavailableException);
});

test('vehicle availability contains only real fleet vehicles and embeds confirmed crew and assignment details', async () => {
  const provider = new FakeFleetProvider();
  const deps = dependencies(provider);
  const service = new FleetService(deps.prisma, { lookup: async()=>new Map() }, deps.bookings, provider);
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
  const service = new FleetService(deps.prisma, { lookup: async()=>new Map() }, deps.bookings, provider);
  for (const status of ['UNDER_MAINTENANCE', 'UNDER_REPAIR']) {
    provider.vehicleStatus = status;
    await assert.rejects(service.checkAssignment(vehicleId, driverId, [helperId]), /Vehicle is unavailable/);
  }
});
