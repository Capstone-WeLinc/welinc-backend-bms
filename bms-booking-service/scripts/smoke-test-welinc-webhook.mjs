import { createHmac, randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import pg from 'pg';

config({ quiet: true });

const url = process.env.BMS_WEBHOOK_TEST_URL ?? 'http://127.0.0.1:3005/integrations/welinc/bookings';
const secret = process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET;
if (!secret || secret.length < 32) throw new Error('Set a 32+ character test webhook secret');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for the test database');

const suffix = randomUUID();
const externalBookingId = `codex-e2e-${suffix}`;
const base = Date.now();
const occurredAt = (offset) => new Date(base + offset * 1000).toISOString();
const snapshot = (service = 'Delivery') => ({
  customerName: 'Webhook Smoke Test', service, date: '2026-10-02',
  pickupAddress: 'Test pickup', deliveryAddress: 'Test delivery', contact: '+639001234567',
});

async function send(eventId, event, tamper = false) {
  const body = JSON.stringify({ externalBookingId, ...event });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Welinc-Event-Id': eventId,
      'X-Welinc-Timestamp': timestamp,
      'X-Welinc-Signature': `sha256=${tamper ? '0'.repeat(64) : signature}`,
    },
    body,
  });
  const result = await response.json();
  return { status: response.status, result };
}

function check(label, actual, status, expected) {
  if (actual.status !== status || !Object.entries(expected).every(([key, value]) => actual.result[key] === value)) {
    throw new Error(`${label} failed: ${JSON.stringify(actual)}`);
  }
  console.log(`${label}: ${actual.status}`);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let cleanUp = false;
try {
  const created = { eventType: 'booking.created.v1', occurredAt: occurredAt(0), booking: snapshot() };
  const createId = `smoke-create-${suffix}`;
  check('create', await send(createId, created), 202, { applied: true, duplicate: false });
  check('duplicate retry', await send(createId, created), 202, { duplicate: true });
  check('invalid signature', await send(`smoke-bad-${suffix}`, created, true), 401, {});
  check('reused event ID with changed payload', await send(createId, { ...created, booking: snapshot('Moving') }), 409, {});

  const updated = { eventType: 'booking.updated.v1', occurredAt: occurredAt(2), booking: snapshot('Moving') };
  const editId = `smoke-edit-${suffix}`;
  check('edit', await send(editId, updated), 202, { applied: true });
  const staleId = `smoke-stale-${suffix}`;
  check('older edit', await send(staleId, { ...updated, occurredAt: occurredAt(1), booking: snapshot() }), 202, { applied: false, pendingReview: false });
  const cancelId = `smoke-cancel-${suffix}`;
  check('cancel', await send(cancelId, { eventType: 'booking.cancelled.v1', occurredAt: occurredAt(3) }), 202, { applied: true });

  const rows = await db.query(`
    SELECT b.id, b.service, b.status, count(e.event_id)::int AS event_count
    FROM welinc_booking_links l
    JOIN bookings b ON b.id = l.booking_uuid
    JOIN welinc_webhook_events e ON e.external_booking_id = l.external_booking_id
    WHERE l.external_booking_id = $1
    GROUP BY b.id, b.service, b.status
  `, [externalBookingId]);
  if (rows.rowCount !== 1 || rows.rows[0].service !== 'Moving' ||
      rows.rows[0].status !== 'Cancelled' || rows.rows[0].event_count !== 4) {
    throw new Error(`Unexpected database result: ${JSON.stringify(rows.rows)}`);
  }
  console.log('database: one cancelled booking, one link, four recorded events');
  cleanUp = true;
} finally {
  if (cleanUp) {
    await db.query('BEGIN');
    try {
      const link = await db.query('SELECT booking_uuid FROM welinc_booking_links WHERE external_booking_id = $1', [externalBookingId]);
      await db.query('DELETE FROM welinc_webhook_events WHERE external_booking_id = $1', [externalBookingId]);
      await db.query('DELETE FROM welinc_booking_links WHERE external_booking_id = $1', [externalBookingId]);
      if (link.rowCount) await db.query('DELETE FROM bookings WHERE id = $1', [link.rows[0].booking_uuid]);
      await db.query('COMMIT');
      console.log('test rows removed');
    } catch {
      await db.query('ROLLBACK');
      process.exitCode = 1;
      console.error("Webhook smoke-test cleanup failed; inspect its tagged test rows.");
    }
  } else {
    console.error(`Test rows may remain for external booking ${externalBookingId}; inspect before cleanup`);
  }
  await db.end();
}
