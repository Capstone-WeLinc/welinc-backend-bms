#!/usr/bin/env node
// Seeds 12 drivers and 20 helpers with complete profiles.
//
//   npm run seed:crew
//
// Drivers go to the shared WeLinc database (BMS_PARTNER_DATABASE_URL), which the
// local fleet provider reads; helpers go to this service's database (DATABASE_URL).
// Safe to run again: rows are matched on employee ID and updated, never duplicated.
// License expiry dates are set relative to today, so one is always expired and two
// are always expiring soon, which keeps the expiry warnings in the app testable.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const sharedUrl = process.env.BMS_PARTNER_DATABASE_URL;
const dispatchUrl = (process.env.DATABASE_URL || '').replace(/\?schema=.*/, '');
if (!sharedUrl || !dispatchUrl) {
  console.error('BMS_PARTNER_DATABASE_URL and DATABASE_URL must be set (run with: npm run seed:crew).');
  process.exit(1);
}

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shiftDays = (days) => {
  const date = new Date(`${manilaToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const initials = (name) => name.split(/\s+/).filter((part) => /^[A-Z]/.test(part)).slice(0, 2).map((part) => part[0]).join('');

// Contacts are stored the way the app saves them (+63...), and shown as 09... in the UI.
const DRIVERS = [
  { name: 'Ramon Dela Cruz', contact: '+639171234501', email: 'ramon.delacruz@welinc.ph', address: '12 Mabini St, Brgy. San Roque, Marikina City', license: 'N01-15-102341', expiry: '2028-03-14', joined: '2021-02-15', trips: 214, emergency: ['Liza Dela Cruz', '+639181234501'] },
  { name: 'Danilo Ramos', contact: '+639171234502', email: 'danilo.ramos@welinc.ph', address: '45 Rizal Ave, Brgy. Poblacion, Makati City', license: 'N02-16-208452', expiry: '2027-08-22', joined: '2021-06-01', trips: 198, emergency: ['Teresa Ramos', '+639181234502'] },
  { name: 'Edgardo Santos', contact: '+639171234503', email: 'edgardo.santos@welinc.ph', address: '7 Kalayaan Ave, Brgy. Pinyahan, Quezon City', license: 'N03-14-311563', expiry: 'EXPIRING_SOON_1', joined: '2020-11-10', trips: 251, emergency: ['Marites Santos', '+639181234503'] },
  { name: 'Eduardo Bautista', contact: '+639171234504', email: 'eduardo.bautista@welinc.ph', address: '88 Aurora Blvd, Brgy. Valencia, Quezon City', license: 'N04-17-415674', expiry: '2029-01-30', joined: '2022-01-17', trips: 156, emergency: ['Gloria Bautista', '+639181234504'] },
  { name: 'Rogelio Mendoza', contact: '+639171234505', email: 'rogelio.mendoza@welinc.ph', address: '23 Shaw Blvd, Brgy. Wack-Wack, Mandaluyong City', license: 'N05-18-519785', expiry: 'EXPIRED', joined: '2022-04-04', trips: 132, emergency: ['Carmela Mendoza', '+639181234505'] },
  { name: 'Ernesto Villanueva', contact: '+639171234506', email: 'ernesto.villanueva@welinc.ph', address: '5 Ortigas Ave, Brgy. Ugong, Pasig City', license: 'N06-15-623896', expiry: '2027-11-05', joined: '2021-09-20', trips: 187, emergency: ['Rosario Villanueva', '+639181234506'] },
  { name: 'Alberto Garcia', contact: '+639171234507', email: 'alberto.garcia@welinc.ph', address: '31 Dr. A. Santos Ave, Brgy. San Antonio, Parañaque City', license: 'N07-19-727907', expiry: '2028-06-18', joined: '2023-02-13', trips: 104, emergency: ['Nenita Garcia', '+639181234507'] },
  { name: 'Ricardo Aquino', contact: '+639171234508', email: 'ricardo.aquino@welinc.ph', address: '19 Alabang-Zapote Rd, Brgy. Almanza Uno, Las Piñas City', license: 'N08-16-831018', expiry: 'EXPIRING_SOON_2', joined: '2022-08-08', trips: 143, emergency: ['Evelyn Aquino', '+639181234508'] },
  { name: 'Fernando Castillo', contact: '+639171234509', email: 'fernando.castillo@welinc.ph', address: '62 McArthur Hwy, Brgy. Malanday, Valenzuela City', license: 'N09-20-935129', expiry: '2029-09-12', joined: '2023-06-05', trips: 88, emergency: ['Josefina Castillo', '+639181234509'] },
  { name: 'Manuel Reyes', contact: '+639171234510', email: 'manuel.reyes@welinc.ph', address: '14 Samson Rd, Brgy. Sangandaan, Caloocan City', license: 'N10-17-140230', expiry: '2028-12-01', joined: '2022-11-21', trips: 121, emergency: ['Corazon Reyes', '+639181234510'] },
  { name: 'Jose Navarro', contact: '+639171234511', email: 'jose.navarro@welinc.ph', address: '9 Gen. Luna St, Brgy. Tañong, Malabon City', license: 'N11-21-244341', expiry: '2030-04-27', joined: '2024-03-11', trips: 61, emergency: ['Ana Navarro', '+639181234511'] },
  { name: 'Antonio Flores', contact: '+639171234512', email: 'antonio.flores@welinc.ph', address: '27 C. Raymundo Ave, Brgy. Caniogan, Pasig City', license: 'N12-22-348452', expiry: '2030-10-09', joined: '2024-09-02', trips: 37, emergency: ['Leticia Flores', '+639181234512'] },
];

const HELPERS = [
  ['Mark Anthony Cruz', '2021-03-08', 176, 'Maria Cruz'],
  ['John Paul Reyes', '2021-05-17', 165, 'Lourdes Reyes'],
  ['Christian Bautista', '2021-08-02', 149, 'Elena Bautista'],
  ['Jerome Santos', '2021-10-25', 142, 'Imelda Santos'],
  ['Kevin Mendoza', '2022-01-10', 131, 'Cecilia Mendoza'],
  ['Ryan Villanueva', '2022-02-21', 127, 'Remedios Villanueva'],
  ['Joshua Garcia', '2022-04-18', 119, 'Victoria Garcia'],
  ['Mark Joseph Aquino', '2022-06-06', 112, 'Erlinda Aquino'],
  ['Carlo Castillo', '2022-08-15', 104, 'Milagros Castillo'],
  ['Jayson Torres', '2022-10-03', 98, 'Perla Torres'],
  ['Arnel Ramos', '2022-12-12', 91, 'Divina Ramos'],
  ['Rodel Fernandez', '2023-02-06', 84, 'Luzviminda Fernandez'],
  ['Jomar Pascual', '2023-04-24', 77, 'Adelaida Pascual'],
  ['Renato Salazar', '2023-07-10', 69, 'Natividad Salazar'],
  ['Dennis Ocampo', '2023-09-18', 60, 'Felicidad Ocampo'],
  ['Allan Domingo', '2023-12-04', 52, 'Rosalinda Domingo'],
  ['Vincent Manalo', '2024-02-19', 43, 'Estrella Manalo'],
  ['Jerwin Soriano', '2024-05-13', 35, 'Herminia Soriano'],
  ['Paolo Mercado', '2024-08-26', 22, 'Consuelo Mercado'],
  ['Bryan Galang', '2025-01-20', 11, 'Purita Galang'],
].map(([name, joined, trips, emergencyName], index) => ({
  empId: `HLP-${String(index + 1).padStart(3, '0')}`,
  name, joined, trips, emergencyName,
  // Same pattern as the drivers: first.last@welinc.ph, without spaces in compound first names.
  email: `${name.toLowerCase().split(/\s+/).slice(0, -1).join('')}.${name.toLowerCase().split(/\s+/).at(-1)}@welinc.ph`,
  contact: `+63917235${String(index + 1).padStart(4, '0')}`,
  emergencyContact: `+63918235${String(index + 1).padStart(4, '0')}`,
}));

const expiryFor = (value) => ({ EXPIRED: shiftDays(-15), EXPIRING_SOON_1: shiftDays(12), EXPIRING_SOON_2: shiftDays(25) })[value] ?? value;

const shared = new pg.Client({ connectionString: sharedUrl });
const dispatch = new pg.Client({ connectionString: dispatchUrl });
await Promise.all([shared.connect(), dispatch.connect()]);
try {
  await shared.query('BEGIN');
  for (const [index, driver] of DRIVERS.entries()) {
    const empId = `DRV-${String(index + 1).padStart(3, '0')}`;
    await shared.query(`
      INSERT INTO drivers (id, emp_id, name, initials, license_number, license_type, license_expiry, contact, email, address,
        crew_status, total_trips, join_date, emergency_name, emergency_contact, is_verified, is_active, deleted_at, created_at, updated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, 'Professional', $6, $7, $8, $9, 'Available', $10, $11, $12, $13, true, true, NULL, now(), now())
      ON CONFLICT (emp_id) DO UPDATE SET name = EXCLUDED.name, initials = EXCLUDED.initials, license_number = EXCLUDED.license_number,
        license_type = EXCLUDED.license_type, license_expiry = EXCLUDED.license_expiry, contact = EXCLUDED.contact, email = EXCLUDED.email,
        address = EXCLUDED.address, crew_status = EXCLUDED.crew_status, total_trips = EXCLUDED.total_trips, join_date = EXCLUDED.join_date,
        emergency_name = EXCLUDED.emergency_name, emergency_contact = EXCLUDED.emergency_contact, is_verified = true, is_active = true,
        deleted_at = NULL, updated_at = now()`,
    [randomUUID(), empId, driver.name, initials(driver.name), driver.license, expiryFor(driver.expiry), driver.contact, driver.email,
      driver.address, driver.trips, driver.joined, driver.emergency[0], driver.emergency[1]]);
  }
  await shared.query('COMMIT');

  await dispatch.query('BEGIN');
  for (const helper of HELPERS) {
    await dispatch.query(`
      INSERT INTO helpers (id, emp_id, name, initials, contact, email, crew_status, total_trips, join_date, emergency_name, emergency_contact, is_active, created_at, updated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, $10, 'Available', $6, $7, $8, $9, true, now(), now())
      ON CONFLICT (emp_id) DO UPDATE SET name = EXCLUDED.name, initials = EXCLUDED.initials, contact = EXCLUDED.contact, email = EXCLUDED.email,
        crew_status = EXCLUDED.crew_status, total_trips = EXCLUDED.total_trips, join_date = EXCLUDED.join_date,
        emergency_name = EXCLUDED.emergency_name, emergency_contact = EXCLUDED.emergency_contact, is_active = true, updated_at = now()`,
    [randomUUID(), helper.empId, helper.name, initials(helper.name), helper.contact, helper.trips, helper.joined, helper.emergencyName, helper.emergencyContact, helper.email]);
  }
  // Helpers added in the app continue numbering after the seeded ones (HLP-021, ...).
  await dispatch.query(`SELECT setval('dispatch_helper_emp_no_seq', GREATEST((SELECT COALESCE(MAX(NULLIF(regexp_replace(emp_id, '[^0-9]', '', 'g'), '')::bigint), 1) FROM helpers), 1))`);
  await dispatch.query('COMMIT');

  const drivers = (await shared.query(`SELECT count(*) FROM drivers WHERE is_active AND deleted_at IS NULL AND emp_id LIKE 'DRV-0%'`)).rows[0].count;
  const helpers = (await dispatch.query('SELECT count(*) FROM helpers WHERE is_active')).rows[0].count;
  console.log(`Seeded crew: ${drivers} drivers, ${helpers} helpers.`);
} catch (error) {
  await shared.query('ROLLBACK').catch(() => {});
  await dispatch.query('ROLLBACK').catch(() => {});
  console.error('Seeding failed, nothing from the failing step was saved:', error.message);
  process.exitCode = 1;
} finally {
  await Promise.all([shared.end(), dispatch.end()]);
}
