import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import pg from 'pg';

config({ quiet: true });
const base = process.env.BOOKING_TEST_URL ?? 'http://127.0.0.1:3021';

function token(role,system='BMS') {
  const name=system==='BMS'?`BMS_TEST_${role}_ACCESS_TOKEN`:'BMS_TEST_FOREIGN_ACCESS_TOKEN';
  const value=process.env[name];if(!value)throw new Error(`Provide ${name} from a real suite test session`);return value;
}

async function call(path, method = 'GET', body, bearer) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(bearer && { Authorization: `Bearer ${bearer}` }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function expectStatus(label, actual, status) {
  if (actual.status !== status) throw new Error(`${label}: expected ${status}, got ${actual.status}: ${JSON.stringify(actual.body)}`);
  console.log(`${label}: ${status}`);
}

const admin = token('ADMIN');
const foreignAdmin = token('ADMIN', 'OTHER');
expectStatus('unauthenticated list', await call('/booking'), 401);
expectStatus('foreign system role', await call('/booking', 'GET', undefined, foreignAdmin), 403);
const routeInput = { pickupAddress: 'Test pickup', deliveryAddress: 'Test delivery' };
expectStatus('unauthenticated route', await call('/booking/route', 'POST', routeInput), 401);
expectStatus('foreign system route', await call('/booking/route', 'POST', routeInput, foreignAdmin), 403);
expectStatus('invalid route body', await call('/booking/route', 'POST', { pickupAddress: 'Test pickup' }, admin), 400);
if (!process.env.GOOGLE_MAPS_API_KEY) {
  expectStatus('route without Google key', await call('/booking/route', 'POST', routeInput, admin), 503);
}
const created = await call('/booking', 'POST', {
  client: `codex-e2e-booking-api-${randomUUID()}`, service: 'Delivery', date: '2026-10-02',
  pickupAddress: 'Test pickup', deliveryAddress: 'Test delivery',
  amount: '1200.00', totalAmount: '₱1,200.00', paymentStatus: 'Pending',
  paymentMethod: 'GCash', status: 'For Plotting', deliveryLocation: 'Test delivery',
  additionalServicesAvailed: [{ name: 'Packing', price: '₱200.00' }],
}, admin);
expectStatus('create', created, 201);
const id = created.body.id;
if (!id || created.body.version !== 1 || !created.body.bookingNo) throw new Error('Create returned an incomplete booking');
if (created.body.amount !== '1200' && created.body.amount !== '1200.00') throw new Error('Quoted amount was not preserved');
if (created.body.totalAmount !== '₱1,200.00' || created.body.requestedPaymentMethod !== 'GCash' ||
  created.body.deliveryLocation !== 'Test delivery' || created.body.additionalServicesAvailed?.[0]?.name !== 'Packing') {
  throw new Error('Booking wizard details were not preserved');
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let success = false;
try {
  expectStatus('reject claimed paid booking', await call('/booking', 'POST', {
    client: 'Invalid payment', service: 'Delivery', date: '2026-10-02', paymentStatus: 'Paid',
  }, admin), 400);
  const edited = await call(`/booking/${id}`, 'PUT', {
    expectedVersion: 1, service: 'Moving', address: 'Updated destination',
    itemDetails: 'Two boxes', specialInstructions: 'Call first', permitRequired: true,
  }, admin);
  expectStatus('versioned edit', edited, 200);
  if (edited.body.version !== 2 || edited.body.status !== 'Rescheduled' ||
    edited.body.address !== 'Updated destination' || edited.body.itemDetails !== 'Two boxes' || !edited.body.permitRequired) {
    throw new Error('Edit did not preserve form fields or advance version/status');
  }
  expectStatus('stale version', await call(`/booking/${id}`, 'PUT', { expectedVersion: 1, service: 'Delivery' }, admin), 409);
  expectStatus('reject payment write', await call(`/booking/${id}`, 'PUT', { expectedVersion: 2, paymentStatus: 'Paid' }, admin), 400);
  const read = await call(`/booking/${id}`, 'GET', undefined, admin);
  expectStatus('read', read, 200);
  if (read.body.service !== 'Moving') throw new Error('Read did not return the edited booking');
  const flagged = await call(`/booking/${id}`, 'PUT', {
    expectedVersion: 2, status: 'For Plotting', discrepancyNote: 'Confirm address', flagged: true,
  }, admin);
  expectStatus('flag discrepancy', flagged, 200);
  if (flagged.body.version !== 3 || !flagged.body.flagged || flagged.body.discrepancyNote !== 'Confirm address') {
    throw new Error('Discrepancy fields were not stored');
  }
  const cancelled = await call(`/booking/${id}`, 'PUT', { expectedVersion: 3, status: 'Cancelled' }, admin);
  expectStatus('cancel', cancelled, 200);
  expectStatus('reject edit after cancel', await call(`/booking/${id}`, 'PUT', {
    expectedVersion: 4, client: 'Should not change',
  }, admin), 409);
  success = true;
} finally {
  await db.query('DELETE FROM bookings WHERE id = $1', [id]);
  await db.end();
  console.log('test booking removed');
}
if (!success) process.exitCode = 1;
