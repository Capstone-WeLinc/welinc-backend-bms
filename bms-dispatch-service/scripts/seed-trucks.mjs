#!/usr/bin/env node
// Seeds 12 trucks that match the preferred trucks a customer can pick in a booking.
//
//   npm run seed:trucks
//
// Trucks go to the shared WeLinc database (BMS_PARTNER_DATABASE_URL), which the
// local fleet provider reads. Each truck's truck_type_id is the same value the
// booking's preferred truck uses, so Assign resources can match them:
//   6W 14ft. with Lifter  | 10ft. Closed Van  | 4W L300 FB Van
// Helper counts follow the rate card: the 6W and 10ft vans run with 2 helpers,
// the L300 with 1, and two L300s are set up for the "(2 Helpers)" option.
// Safe to run again: rows are matched on plate number and updated, never duplicated.
// Expiry and status dates are set relative to today, so the warnings in the app stay testable.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const sharedUrl = process.env.BMS_PARTNER_DATABASE_URL;
if (!sharedUrl) {
  console.error('BMS_PARTNER_DATABASE_URL must be set (run with: npm run seed:trucks).');
  process.exit(1);
}

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDays = (days) => {
  const date = new Date(`${manilaToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
// Fixed dates stay as written; numbers are days from today.
const day = (value) => (typeof value === 'number' ? shiftDays(value) : value);

const SIX_WHEELER = { type: '6W 14ft. with Lifter', capacity: 3500, helpers: 2 };
const CLOSED_VAN = { type: '10ft. Closed Van', capacity: 2000, helpers: 2 };
const L300 = { type: '4W L300 FB Van', capacity: 1000, helpers: 1 };

const TRUCKS = [
  // 6W 14ft. with Lifter
  { plate: 'NBA-2041', kind: SIX_WHEELER, brand: 'Isuzu', model: 'Elf NPR 14ft. Wing Van w/ Lifter', year: 2022, color: 'White', garage: 'Marikina', mileage: 48210, reg: '2027-03-18', ins: '2027-02-28', lastPms: -35, nextPms: 55 },
  { plate: 'NBC-5560', kind: SIX_WHEELER, brand: 'Hino', model: '300 Series 14ft. Dropside w/ Lifter', year: 2021, color: 'White', garage: 'Sta. Rosa', mileage: 67430, reg: '2027-06-09', ins: 20, lastPms: -50, nextPms: 40 },
  { plate: 'NBE-9035', kind: SIX_WHEELER, brand: 'Mitsubishi Fuso', model: 'Canter 14ft. Aluminum Van w/ Lifter', year: 2023, color: 'White', garage: 'Pulilan', mileage: 29870, reg: '2027-10-21', ins: '2027-09-30', lastPms: -10, nextPms: 80 },
  { plate: 'NBF-3127', kind: SIX_WHEELER, brand: 'Isuzu', model: 'Elf NPR 14ft. Wing Van w/ Lifter', year: 2020, color: 'White', garage: 'Marikina', mileage: 91560, reg: '2027-01-14', ins: '2027-01-14', lastPms: -88, nextPms: 2,
    status: 'UNDER_MAINTENANCE', reason: 'Scheduled 90,000 km preventive maintenance (PMS)', since: -1, back: 2, remarks: 'Change oil, brake check and lifter hydraulics inspection at the Marikina garage.' },
  // 10ft. Closed Van
  { plate: 'NCA-7716', kind: CLOSED_VAN, brand: 'Isuzu', model: 'Traviz 10ft. Closed Van', year: 2023, color: 'White', garage: 'Marikina', mileage: 31240, reg: '2027-08-05', ins: '2027-07-31', lastPms: -20, nextPms: 70 },
  { plate: 'NCB-8824', kind: CLOSED_VAN, brand: 'Isuzu', model: 'Elf NHR 10ft. Closed Van', year: 2021, color: 'White', garage: 'Sta. Rosa', mileage: 72910, reg: 25, ins: '2027-05-16', lastPms: -60, nextPms: 30 },
  { plate: 'NCD-4402', kind: CLOSED_VAN, brand: 'Suzuki', model: 'Carry 10ft. Aluminum Closed Van', year: 2024, color: 'Silver', garage: 'Pulilan', mileage: 14650, reg: '2028-02-12', ins: '2028-01-31', lastPms: -15, nextPms: 75 },
  { plate: 'NCE-6189', kind: CLOSED_VAN, brand: 'Isuzu', model: 'Traviz 10ft. Closed Van', year: 2022, color: 'White', garage: 'Marikina', mileage: 45780, reg: '2027-04-27', ins: '2027-04-27', lastPms: -40, nextPms: 50 },
  // 4W L300 FB Van
  { plate: 'NDA-3398', kind: L300, brand: 'Mitsubishi', model: 'L300 FB Exceed Dual Aircon', year: 2023, color: 'White', garage: 'Marikina', mileage: 38420, reg: '2027-09-03', ins: '2027-08-29', lastPms: -25, nextPms: 65 },
  { plate: 'NDB-1207', kind: L300, brand: 'Mitsubishi', model: 'L300 FB Exceed Dual Aircon', year: 2021, color: 'White', garage: 'Sta. Rosa', mileage: 84130, reg: -10, ins: '2027-03-22', lastPms: -70, nextPms: 20,
    status: 'UNDER_REPAIR', reason: 'Clutch replacement', since: -3, back: 4, remarks: 'Registration renewal follows once the repair is done.' },
  { plate: 'NDC-6643', kind: { ...L300, helpers: 2 }, brand: 'Mitsubishi', model: 'L300 FB Exceed Dual Aircon', year: 2024, color: 'White', garage: 'Pulilan', mileage: 18960, reg: '2028-03-07', ins: '2028-02-28', lastPms: -12, nextPms: 78 },
  { plate: 'NDE-2875', kind: { ...L300, helpers: 2 }, brand: 'Mitsubishi', model: 'L300 FB Exceed Dual Aircon', year: 2022, color: 'White', garage: 'Marikina', mileage: 52370, reg: '2027-07-19', ins: '2027-07-19', lastPms: -45, nextPms: 45 },
];

const shared = new pg.Client({ connectionString: sharedUrl });
await shared.connect();
try {
  await shared.query('BEGIN');
  // The trucks are kept in three garages; make sure they exist.
  for (const name of new Set(TRUCKS.map((truck) => truck.garage))) {
    await shared.query(`
      INSERT INTO garages (id, name, is_active, deleted_at, created_at, updated_at) VALUES ($1::uuid, $2, true, NULL, now(), now())
      ON CONFLICT (name) DO UPDATE SET is_active = true, deleted_at = NULL, updated_at = now()`, [randomUUID(), name]);
  }
  for (const [index, truck] of TRUCKS.entries()) {
    const status = truck.status || 'AVAILABLE';
    const away = status !== 'AVAILABLE';
    await shared.query(`
      INSERT INTO vehicles (id, plate_number, alias, brand, model, type, truck_type_id, year, color, fuel, capacity, required_helpers,
        mileage, odometer, reg_expiry, ins_expiry, last_maintenance, next_maintenance, garage, status, status_reason, status_since,
        expected_back_at, status_remarks, driver_id, is_active, deleted_at, created_at, updated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $6, $7, $8, 'Diesel', $9, $10, $11, $11, $12, $13, $14, $15, $16, $17::"VehicleStatus", $18, $19,
        $20, $21, NULL, true, NULL, now(), now())
      ON CONFLICT (plate_number) DO UPDATE SET alias = EXCLUDED.alias, brand = EXCLUDED.brand, model = EXCLUDED.model, type = EXCLUDED.type,
        truck_type_id = EXCLUDED.truck_type_id, year = EXCLUDED.year, color = EXCLUDED.color, fuel = EXCLUDED.fuel, capacity = EXCLUDED.capacity,
        required_helpers = EXCLUDED.required_helpers, mileage = EXCLUDED.mileage, odometer = EXCLUDED.odometer, reg_expiry = EXCLUDED.reg_expiry,
        ins_expiry = EXCLUDED.ins_expiry, last_maintenance = EXCLUDED.last_maintenance, next_maintenance = EXCLUDED.next_maintenance,
        garage = EXCLUDED.garage, status = EXCLUDED.status, status_reason = EXCLUDED.status_reason, status_since = EXCLUDED.status_since,
        expected_back_at = EXCLUDED.expected_back_at, status_remarks = EXCLUDED.status_remarks, driver_id = NULL, is_active = true,
        deleted_at = NULL, updated_at = now()`,
    [randomUUID(), truck.plate, `Unit ${String(index + 1).padStart(2, '0')}`, truck.brand, truck.model, truck.kind.type, truck.year,
      truck.color, truck.kind.capacity, truck.kind.helpers, truck.mileage, day(truck.reg), day(truck.ins), day(truck.lastPms), day(truck.nextPms),
      truck.garage, status, away ? truck.reason : null, away ? day(truck.since) : null, away ? day(truck.back) : null, away ? truck.remarks : null]);
  }
  await shared.query('COMMIT');

  const { rows } = await shared.query(`SELECT truck_type_id, count(*)::int AS n FROM vehicles WHERE is_active AND deleted_at IS NULL GROUP BY 1 ORDER BY 1`);
  console.log(`Seeded trucks: ${rows.map((row) => `${row.n} x ${row.truck_type_id}`).join(', ')}.`);
} catch (error) {
  await shared.query('ROLLBACK').catch(() => {});
  console.error('Seeding failed, nothing was saved:', error.message);
  process.exitCode = 1;
} finally {
  await shared.end();
}
