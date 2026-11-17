import { createServer } from 'node:http';
import pg from 'pg';
import { workerConfig } from './config.mjs';
const settings = workerConfig(process.env);

const url = process.env.ANALYTICS_READ_MODEL_DATABASE_URL;
if (!url) throw new Error('ANALYTICS_READ_MODEL_DATABASE_URL is required');
const key = process.env.BMS_INTERNAL_SERVICE_KEY;
if (!key || key.length < 32) throw new Error('BMS_INTERNAL_SERVICE_KEY is required');
const pool = new pg.Pool({ connectionString: url, max: settings.max, connectionTimeoutMillis: 1900 });
pool.on('error',()=>console.error('Projection database connection closed'));
let lastSuccess=0;

async function source(root, path) {
  const response = await fetch(new URL(path, root), {
    headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function moneyCents(value) { return Math.round(Number(value ?? 0) * 100); }

export async function projectOnce() {
  const [bookings, assignments, completion] = await Promise.all([
    source(process.env.BOOKING_API_URL || 'http://127.0.0.1:3021', '/internal/booking'),
    source(process.env.DISPATCH_API_URL || 'http://127.0.0.1:3022', '/internal/dispatch/assignments'),
    source(process.env.COMPLETION_API_URL || 'http://127.0.0.1:3023', '/internal/completion/read-model'),
  ]);
  const assignmentByBooking = new Map(assignments.map((row) => [row.bookingUuid, row]));
  const workByBooking = new Map(completion.work.map((row) => [row.bookingUuid, row]));
  const refundsByCollection = new Map();
  for (const refund of completion.refunds) refundsByCollection.set(refund.collectionId, (refundsByCollection.get(refund.collectionId) || 0) + moneyCents(refund.amount));
  const collectionsByBooking = new Map();
  for (const collection of completion.collections) {
    const list = collectionsByBooking.get(collection.bookingUuid) || [];
    list.push(collection);
    collectionsByBooking.set(collection.bookingUuid, list);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (const booking of bookings) {
      ids.push(booking.id);
      const assignment = assignmentByBooking.get(booking.id);
      const work = workByBooking.get(booking.id);
      const collections = collectionsByBooking.get(booking.id) || [];
      const paidCents = collections.reduce((sum, row) => sum + moneyCents(row.amount) - (refundsByCollection.get(row.id) || 0), 0);
      const amountCents = booking.amount == null ? null : moneyCents(booking.amount);
      const paymentStatus = paidCents <= 0 ? 'Pending' : amountCents !== null && paidCents >= amountCents ? 'Paid' : 'Partial';
      const lastCollection = collections.at(-1);
      await client.query(`INSERT INTO bookings (
        id, booking_id, booking_no, client, service, date, pickup_address, delivery_address,
        status, amount, created_at, updated_at, service_type, address, payment_status,
        payment_method, full_name, contact, email, notes, services_availed, protective_materials,
        post_service_status, amount_paid, arrival_time, additional_materials, completion_notes,
        issue_reported, issue_details, finalized_at, finalized_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
        ON CONFLICT (id) DO UPDATE SET
          booking_id=EXCLUDED.booking_id, booking_no=EXCLUDED.booking_no, client=EXCLUDED.client,
          service=EXCLUDED.service, date=EXCLUDED.date, pickup_address=EXCLUDED.pickup_address,
          delivery_address=EXCLUDED.delivery_address, status=EXCLUDED.status, amount=EXCLUDED.amount,
          updated_at=EXCLUDED.updated_at, service_type=EXCLUDED.service_type, address=EXCLUDED.address,
          payment_status=EXCLUDED.payment_status, payment_method=EXCLUDED.payment_method,
          full_name=EXCLUDED.full_name, contact=EXCLUDED.contact, email=EXCLUDED.email, notes=EXCLUDED.notes,
          services_availed=EXCLUDED.services_availed, protective_materials=EXCLUDED.protective_materials,
          post_service_status=EXCLUDED.post_service_status, amount_paid=EXCLUDED.amount_paid,
          arrival_time=EXCLUDED.arrival_time, additional_materials=EXCLUDED.additional_materials,
          completion_notes=EXCLUDED.completion_notes, issue_reported=EXCLUDED.issue_reported,
          issue_details=EXCLUDED.issue_details, finalized_at=EXCLUDED.finalized_at, finalized_by=EXCLUDED.finalized_by`,
        [booking.id, booking.bookingId, booking.bookingNo, booking.client, booking.service,
          booking.date, booking.pickupAddress, booking.deliveryAddress,
          booking.status, booking.amount, booking.createdAt, booking.updatedAt,
          booking.serviceType, booking.address, paymentStatus, lastCollection?.method ?? null,
          booking.fullName, booking.contact, booking.email, booking.notes,
          booking.servicesAvailed ?? [], booking.protectiveMaterials ?? [],
          work?.postServiceStatus ?? 'Pending Review', paidCents / 100,
          work?.arrivalTime ?? null, work?.additionalMaterials ?? [], work?.completionNotes ?? null,
          work?.issueReported ?? false, work?.issueDetails ?? null, work?.finalizedAt ?? null,
          work?.finalizedBy ?? null]);
      await client.query(`INSERT INTO bms_projection_rows (booking_uuid, projected_at) VALUES ($1, now())
        ON CONFLICT (booking_uuid) DO UPDATE SET projected_at=now()`, [booking.id]);
      if (assignment) {
        await client.query(`INSERT INTO scheduled_bookings
          (id, booking_id, dispatch_time, garage, delivery_type, vehicle_id, driver_id, helper_ids, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (booking_id) DO UPDATE SET dispatch_time=EXCLUDED.dispatch_time,
          garage=EXCLUDED.garage, delivery_type=EXCLUDED.delivery_type, vehicle_id=EXCLUDED.vehicle_id,
          driver_id=EXCLUDED.driver_id, helper_ids=EXCLUDED.helper_ids, updated_at=EXCLUDED.updated_at`,
          [assignment.id, booking.id, assignment.dispatchTime, assignment.garage,
            assignment.deliveryType, assignment.vehicleId, assignment.driverId, assignment.helperIds,
            assignment.createdAt, assignment.updatedAt]);
      } else {
        await client.query('DELETE FROM scheduled_bookings WHERE booking_id=$1', [booking.id]);
      }
    }
    const stale = await client.query('SELECT booking_uuid FROM bms_projection_rows WHERE NOT (booking_uuid = ANY($1::uuid[]))', [ids]);
    for (const row of stale.rows) await client.query('DELETE FROM bookings WHERE id=$1', [row.booking_uuid]);
    await client.query('DELETE FROM bms_projection_rows WHERE NOT (booking_uuid = ANY($1::uuid[]))', [ids]);
    await client.query('COMMIT');
    return { bookings: bookings.length, assignments: assignments.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (process.argv[1]?.endsWith('worker.mjs')) {
  const once = process.argv.includes('--once');
  const run = async () => {
    try { const result=await projectOnce();lastSuccess=Date.now();console.log(JSON.stringify({ status: 'ok', ...result })); }
    catch (error) { const code=/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'UPSTREAM_OR_DATABASE';console.error('Analytics projection failed ('+code+')'); if (once) process.exitCode = 1; }
  };
  if (!once) createServer((_req,res)=>{const ok=lastSuccess>0 && Date.now()-lastSuccess<Math.max(30000,3*Number(process.env.PROJECTION_INTERVAL_MS??10000));res.writeHead(ok?200:503,{'content-type':'application/json'});res.end(JSON.stringify({status:ok?'ok':'unavailable'}));}).listen(Number(process.env.PORT??3024),'0.0.0.0');
  await run();
  if (!once) {
    const interval = Math.max(1000, Number(process.env.PROJECTION_INTERVAL_MS) || 10000);
    const repeat = async () => { await run(); setTimeout(repeat, interval); };
    setTimeout(repeat, interval);
  } else await pool.end();
}
