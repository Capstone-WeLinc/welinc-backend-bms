import { createHmac, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import pg from 'pg';

config({ quiet: true });
const base = process.env.BOOKING_TEST_URL ?? 'http://127.0.0.1:3002';
if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) throw new Error('Configure local JWT_SECRET and DATABASE_URL');

function token(role, system = 'BMS') {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({ sub: `smoke-${randomUUID()}`, roles: [{ role, system }], exp: Math.floor(Date.now() / 1000) + 120 });
  const signature = createHmac('sha256', process.env.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

async function call(path, method = 'GET', body, bearer) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(bearer && { Authorization: `Bearer ${bearer}` }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function expect(label, actual, status) {
  if (actual.status !== status) throw new Error(`${label}: expected ${status}, got ${actual.status}: ${JSON.stringify(actual.body)}`);
  console.log(`${label}: ${status}`);
}

const root = '/bms/config';
const admin = token('ADMIN');
const support = token('CUSTOMER_SUPPORT');
expect('unauthenticated catalog', await call(`${root}/booking-services`), 401);
expect('foreign system role', await call(`${root}/booking-services`, 'GET', undefined, token('ADMIN', 'OTHER')), 403);
expect('operations catalog role', await call(`${root}/booking-services`, 'GET', undefined, token('OPERATIONS')), 403);
expect('support read', await call(`${root}/booking-services`, 'GET', undefined, support), 200);
expect('support write rejected', await call(`${root}/booking-services`, 'POST', { name: 'Not allowed' }, support), 403);
expect('invalid price', await call(`${root}/services-offered`, 'POST', { name: 'Invalid', price: -1 }, admin), 400);
expect('too many price decimals', await call(`${root}/services-offered`, 'POST', { name: 'Invalid', price: 12.345 }, admin), 400);
expect('invalid catalog ID', await call(`${root}/booking-services/not-a-uuid`, 'PATCH', { name: 'Invalid' }, admin), 400);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const created = [];
try {
  for (const [path, table, body] of [
    ['booking-services', 'booking_services_catalog', { name: `codex-e2e-primary-${randomUUID()}`, description: 'Local test' }],
    ['services-offered', 'service_offerings', { name: `codex-e2e-addon-${randomUUID()}`, description: 'Local test', duration: '1 hour', price: 125.50 }],
    ['protective-materials', 'protective_materials_catalog', { name: `codex-e2e-material-${randomUUID()}`, price: 49.75 }],
  ]) {
    const saved = await call(`${root}/${path}`, 'POST', body, admin);
    expect(`create ${path}`, saved, 201);
    created.push({ table, id: saved.body.id });
    if (saved.body.name !== body.name) throw new Error(`Name mismatch for ${path}`);
    if (body.price !== undefined && saved.body.price !== body.price) throw new Error(`Price mismatch for ${path}`);
    expect(`duplicate ${path}`, await call(`${root}/${path}`, 'POST', body, admin), 400);
    const list = await call(`${root}/${path}`, 'GET', undefined, support);
    expect(`list ${path}`, list, 200);
    if (!list.body.some((item) => item.id === saved.body.id)) throw new Error(`New ${path} item is missing`);
    const another = list.body.find((item) => item.id !== saved.body.id);
    if (another) expect(`duplicate rename ${path}`, await call(`${root}/${path}/${saved.body.id}`, 'PATCH', { name: another.name }, admin), 400);
    const changed = await call(`${root}/${path}/${saved.body.id}`, 'PATCH', { description: 'Updated local test' }, admin);
    expect(`update ${path}`, changed, 200);
    if (changed.body.description !== 'Updated local test') throw new Error(`Update did not apply for ${path}`);
    expect(`remove ${path}`, await call(`${root}/${path}/${saved.body.id}`, 'DELETE', undefined, admin), 200);
    const hidden = await call(`${root}/${path}`, 'GET', undefined, support);
    if (hidden.body.some((item) => item.id === saved.body.id)) throw new Error(`Removed ${path} item remains active`);
    const restored = await call(`${root}/${path}`, 'POST', body, admin);
    expect(`restore ${path}`, restored, 201);
    if (restored.body.id !== saved.body.id) throw new Error(`Restore changed ${path} ID`);
  }
} finally {
  for (const item of created.reverse()) {
    await db.query(`DELETE FROM "${item.table}" WHERE id = $1`, [item.id]);
  }
  await db.end();
  console.log('catalog test rows removed');
}
