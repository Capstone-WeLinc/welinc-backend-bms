import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';

config({ quiet: true });
const base = process.env.DISPATCH_TEST_URL ?? 'http://127.0.0.1:3022';

function token(role,system='BMS') {
  const name=system==='BMS'?`BMS_TEST_${role}_ACCESS_TOKEN`:'BMS_TEST_FOREIGN_ACCESS_TOKEN';
  const value=process.env[name];if(!value)throw new Error(`Provide ${name} from a real suite test session`);return value;
}

async function call(path, bearer, method = 'GET') {
  const response = await fetch(`${base}${path}`, { method, headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
  return { status: response.status, body: await response.json() };
}

function expect(label, actual, status) {
  if (actual.status !== status) throw new Error(`${label}: expected ${status}, got ${actual.status}`);
  console.log(`${label}: ${status}`);
}

expect('readiness', await call('/health/ready'), 200);
expect('unauthenticated assignments', await call('/dispatch/assignments'), 401);
expect('foreign system role', await call('/dispatch/assignments', token('OPERATIONS', 'OTHER')), 401);
expect('customer support role', await call('/dispatch/assignments', token('CUSTOMER_SUPPORT')), 403);
const operations = token('OPERATIONS');
const assignments = await call('/dispatch/assignments', operations);
expect('BMS operations assignments', assignments, 200);
if (!Array.isArray(assignments.body)) throw new Error('Assignments response is not a list');
const orders = await call('/dispatch/job-orders', operations);
expect('BMS operations job orders', orders, 200);
if (!Array.isArray(orders.body)) throw new Error('Job orders response is not a list');
if (assignments.body.length) {
  const detail = await call(`/dispatch/assignments/${assignments.body[0].bookingUuid}`, operations);
  expect('assignment by booking UUID', detail, 200);
  if (detail.body.id !== assignments.body[0].id) throw new Error('Assignment detail does not match the list');
}
if (orders.body.length) {
  const detail = await call(`/dispatch/job-orders/${orders.body[0].id}`, operations);
  expect('job order detail', detail, 200);
  if (detail.body.bookingUuid !== orders.body[0].bookingUuid) throw new Error('Job order detail lost the booking UUID');
}
expect('invalid assignment ID', await call('/dispatch/assignments/not-a-uuid', operations), 400);
expect('assignment write unavailable', await call('/dispatch/assignments', operations, 'POST'), 404);
console.log(`read-only records: ${assignments.body.length} assignments, ${orders.body.length} job orders`);
