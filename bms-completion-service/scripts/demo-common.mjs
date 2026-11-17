import { createHash } from 'node:crypto';
export const DATASET = 'bms-demo-v1';
export function seedError(code) { const error = new Error(code); error.seedCode = code; return error; }
export function seedId(kind, index) {
  const h = createHash('sha256').update(`${DATASET}:${kind}:${index}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function datePlus(day, offset) { return new Date(Date.parse(day+'T00:00:00Z') + offset*86400000).toISOString().slice(0,10); }
export function scenarios(anchor) {
  const services = ['Lipat Bahay','Office Pull Out','Corporate Delivery','Unit to Unit Transfer'];
  return Array.from({length:150},(_,index)=>{
    const historical=index<144;
    const state=historical ? (index%13===12?'cancelled':'completed') : ['unassigned','unassigned','assigned','assigned','distributed','cancelled'][index-144];
    const date=historical?datePlus(anchor,-90+Math.floor(index*90/144)):datePlus(anchor,[1,2,3,4,0,5][index-144]);
    return {index,id:seedId('booking',index),state,date,time:index%2?'14:00':'08:00',service:services[index%4],amount:1000+(index%10)*250,payment:state==='completed'?['unpaid','pending','partial','paid','refunded'][Math.floor(index/4)%5]:'unpaid'};
  });
}
export async function readManifest() {
  let raw=process.env.BMS_SEED_MANIFEST??'';if(!raw)for await(const chunk of process.stdin)raw+=chunk;
  let value;try{value=JSON.parse(raw);}catch{throw seedError('DEMO_MANIFEST_REQUIRED');}
  if(value?.dataset!==DATASET || !/^\d{4}-\d{2}-\d{2}$/.test(value.anchor??'') || !value.allocations || !value.actors)throw seedError('INVALID_DEMO_MANIFEST');
  return value;
}
const keys = {
  bookings:'id',internal_booking_commands:'command_id',approval_audit_events:'id',
  dispatch_assignments:'id',dispatch_job_orders:'id',work_outcomes:'booking_uuid',
  collections:'id',refunds:'id',refund_requests:'id',daily_submissions:'date',
};
const hash = data => createHash('sha256').update(data).digest('hex');
async function rowHash(db,table,recordId) {
  if(!keys[table])throw seedError('INVALID_SEED_TABLE');
  const result=await db.query(`SELECT to_jsonb(t)::text AS data FROM ${table} t WHERE ${keys[table]}=$1`,[recordId]);
  return result.rows[0]?hash(result.rows[0].data):null;
}
export async function editedBookings(db) {
  const {rows}=await db.query('SELECT * FROM bms_demo_seed_records WHERE dataset_key=$1',[DATASET]);
  const changed=new Set();
  for(const row of rows)if(await rowHash(db,row.table_name,row.record_id)!==row.row_hash)changed.add(row.booking_uuid);
  return [...changed];
}
/** Insert only; a ledger entry detects manual edits/deletions before a partial run resumes. */
export async function insertOwned(db,table,row,bookingId) {
  const pk=keys[table];if(!pk)throw seedError('INVALID_SEED_TABLE');
  const recordId=String(row[pk]);
  const previous=await rowHash(db,table,recordId);
  const {rows}=await db.query('SELECT row_hash FROM bms_demo_seed_records WHERE table_name=$1 AND record_id=$2',[table,recordId]);
  if(previous || rows.length) {
    if(!rows.length) { if(table==='daily_submissions')return false; throw seedError('DEMO_ID_COLLISION_EXISTING_DATA_PRESERVED'); }
    if(previous!==rows[0].row_hash)throw seedError('DEMO_ROW_CHANGED_RERUN_TO_PRESERVE_EDITS');
    return false;
  }
  const names=Object.keys(row);
  if(names.some(name=>!/^\w+$/.test(name)))throw seedError('INVALID_SEED_COLUMN');
  await db.query(`INSERT INTO ${table} (${names.map(n=>`"${n}"`).join(',')}) VALUES (${names.map((_,i)=>'$'+(i+1)).join(',')})`,names.map(n=>row[n]));
  const fingerprint=await rowHash(db,table,recordId);
  await db.query('INSERT INTO bms_demo_seed_records(dataset_key,table_name,record_id,booking_uuid,row_hash) VALUES($1,$2,$3,$4,$5)',[DATASET,table,recordId,bookingId,fingerprint]);
  return true;
}
export async function transaction(db,work) {
  await db.query('BEGIN');
  try { const result=await work();await db.query('COMMIT');return result; }
  catch(error){await db.query('ROLLBACK');throw error;}
}
export function reportSeedFailure(error) {
  const code=error.seedCode ?? (error.code==='42P01'?'MIGRATIONS_REQUIRED':'DATABASE_OR_CONFIGURATION_ERROR');
  console.error('BMS demo seed failed: '+code);process.exitCode=1;
}
