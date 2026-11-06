import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LocalAuthIntegration } from './auth-integration.mjs';

const secret = 'local-contract-test-signing-secret-32-characters';
const adminId = '11111111-1111-4111-8111-111111111111';
const supportId = '22222222-2222-4222-8222-222222222222';

function issueToken(userId, role, exp = Math.floor(Date.now() / 1000) + 60) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId, exp, roles: [{ system: 'BMS', role }],
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function fakeAuthFetch(_url, options = {}) {
  const token = /^Bearer\s+(.+)$/i.exec(options.headers?.authorization || '')?.[1];
  if (!token) return Promise.resolve({ ok: false, status: 401 });
  const parts = token.split('.');
  if (parts.length !== 3) return Promise.resolve({ ok: false, status: 401 });
  const body = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(body).digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], 'base64url'); } catch { return Promise.resolve({ ok: false, status: 401 }); }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return Promise.resolve({ ok: false, status: 401 });
  }
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) {
    return Promise.resolve({ ok: false, status: 401 });
  }
  return Promise.resolve({
    ok: true, status: 200,
    json: async () => ({ id: claims.sub, roles: claims.roles }),
  });
}

function makeAdapter(overrides = {}) {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('WHERE user_id = $1')) return { rows: [{ id: 'activity-1', action: 'Signed in' }] };
      if (sql.includes('JOIN users')) return { rows: [{ id: 'auth-activity-1', action: 'Signed in' }] };
      if (sql.includes('SELECT id, name, email FROM users')) {
        return { rows: [{ id: adminId, name: 'BMS Admin', email: 'admin@example.test' }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    async end() {},
  };
  const adapter = new LocalAuthIntegration({
    bridgeUrl: 'http://127.0.0.1:3000',
    databaseUrl: 'postgresql://local:test@127.0.0.1:5433/welinc_db',
    serviceKey: 'a'.repeat(32),
    fetchImpl: fakeAuthFetch,
    poolFactory: () => pool,
    ...overrides,
  });
  return { adapter, queries };
}

test('Auth contract accepts valid BMS claims and returns profile and combined activity', async () => {
  const { adapter, queries } = makeAdapter();
  const token = issueToken(adminId, 'ADMIN');
  const profile = await adapter.profileActivity(`Bearer ${token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.rows[0].action, 'Signed in');
  assert.deepEqual(queries[0].params, [adminId]);

  const activity = await adapter.activityLogs(`Bearer ${token}`, [[{
    id: 'service-activity-1', actorId: adminId, role: 'ADMIN', action: 'Created booking', createdAt: new Date(),
  }]]);
  assert.equal(activity.status, 200);
  assert.equal(activity.rows.length, 2);
  assert.equal(activity.rows[0].userName, 'BMS Admin');
});

test('Auth contract rejects missing and expired tokens before querying local Auth data', async () => {
  const { adapter, queries } = makeAdapter();
  const missing = await adapter.profileActivity('');
  const expired = await adapter.activityLogs(`Bearer ${issueToken(adminId, 'ADMIN', 1)}`, []);
  assert.equal(missing.status, 401);
  assert.equal(expired.status, 401);
  assert.equal(queries.length, 0);
});

test('Auth contract blocks a valid non-admin role from combined activity logs', async () => {
  const { adapter, queries } = makeAdapter();
  const result = await adapter.activityLogs(`Bearer ${issueToken(supportId, 'CUSTOMER_SUPPORT')}`, []);
  assert.equal(result.status, 403);
  assert.equal(queries.length, 0);
});

test('Auth activity adapter refuses non-loopback databases', async () => {
  let poolOpened = false;
  const { adapter } = makeAdapter({
    databaseUrl: 'postgresql://user:password@auth.example.test/auth',
    poolFactory: () => { poolOpened = true; throw new Error('remote DB must not be opened'); },
  });
  const result = await adapter.profileActivity(`Bearer ${issueToken(adminId, 'ADMIN')}`);
  assert.equal(result.status, 503);
  assert.equal(poolOpened, false);
});
