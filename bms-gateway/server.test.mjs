import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('gateway routes by owner and preserves exact signed webhook bytes', async () => {
  const calls = [];
  const mock = await listen(createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, body: Buffer.concat(chunks), signature: req.headers['x-welinc-signature'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ upstream: req.url }));
  }));
  const address = `http://127.0.0.1:${mock.address().port}`;
  for (const name of ['BOOKING_API_URL', 'DISPATCH_API_URL', 'COMPLETION_API_URL', 'PARTNER_BRIDGE_URL', 'ANALYTICS_API_URL']) {
    process.env[name] = address;
  }
  const { start, owner } = await import('./server.mjs');
  const gateway = start(0);
  await new Promise((resolve) => gateway.once('listening', resolve));
  const base = `http://127.0.0.1:${gateway.address().port}`;
  let mockClosed = false;
  try {
    assert.equal(owner('/booking'), 'booking');
    assert.equal(owner('/bms/config/drivers'), 'dispatch');
    assert.equal(owner('/bms/config/vehicle-availability'), 'dispatch');
    assert.equal(owner('/bms/config/vehicle-availability/vehicle-1/details'), 'dispatch');
    assert.equal(owner('/collections'), 'completion');
    assert.equal(owner('/reports/forecast'), 'analytics');
    assert.equal(owner('/activity-logs'), 'gateway');
    assert.equal(owner('/auth/profile/activity'), 'gateway');
    const raw = Buffer.from('{ "eventType": "booking.created.v1", "unicode": "é" }');
    const webhook = await fetch(`${base}/integrations/welinc/bookings`, {
      method: 'POST', headers: { 'x-welinc-signature': 'sha256=sample', 'content-type': 'application/json' }, body: raw,
    });
    assert.equal(webhook.status, 200);
    assert.deepEqual(calls[0].body, raw);
    assert.equal(calls[0].signature, 'sha256=sample');
    const routed = await fetch(`${base}/api/reports/saved?limit=1`);
    assert.equal(routed.status, 200);
    assert.equal(calls[1].path, '/reports/saved?limit=1');
    const availability = await fetch(`${base}/api/bms/config/vehicle-availability`);
    assert.equal(availability.status, 200);
    assert.equal(calls[2].path, '/bms/config/vehicle-availability');
    const vehicleDetails = await fetch(`${base}/api/bms/config/vehicle-availability/vehicle-1/details`);
    assert.equal(vehicleDetails.status, 200);
    assert.equal(calls[3].path, '/bms/config/vehicle-availability/vehicle-1/details');
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
    assert.equal(calls.length, 4);
    await close(mock);
    mockClosed = true;
    assert.equal((await fetch(`${base}/api/booking`)).status, 502);
  } finally {
    await close(gateway);
    if (!mockClosed) await close(mock);
  }
});
