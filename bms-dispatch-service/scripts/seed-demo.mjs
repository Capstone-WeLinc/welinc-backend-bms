import {assertSeedAllowed} from './seed-guard.mjs';
import {readManifest,scenarios,seedId,insertOwned,editedBookings,transaction,seedError,reportSeedFailure} from './demo-common.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

async function main(){
 assertSeedAllowed();
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  if(process.argv[2]==='inspect'){console.log(JSON.stringify(await editedBookings(db)));return;}
  const manifest=await readManifest(),excluded=new Set(manifest.excludedBookingIds??[]);
  const items=scenarios(manifest.anchor).filter(r=>!excluded.has(r.id)&&!['unassigned','cancelled'].includes(r.state));
  const existing=new Set((await db.query('SELECT booking_uuid FROM dispatch_assignments WHERE booking_uuid=ANY($1::uuid[])',[items.map(i=>i.id)])).rows.map(r=>r.booking_uuid));
  const pending=items.filter(i=>!existing.has(i.id));
  if(pending.length){
   const verification=spawnSync(process.execPath,[fileURLToPath(new URL('./seed-resources.mjs',import.meta.url)),'verify'],{input:JSON.stringify({...manifest,verifyBookingIds:pending.map(i=>i.id)}),encoding:'utf8'});
   if(verification.status!==0)throw seedError('FLEET_UNAVAILABLE_OR_CHANGED_NO_DISPATCH_ROWS_WRITTEN');
  }
  let inserted=0;
  await transaction(db,async()=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['bms-demo-v1']);
   for(const item of items){
    const a=manifest.allocations[item.id];if(!a)throw seedError('DEMO_ALLOCATION_REQUIRED');
    const timestamp=`${item.date}T${item.time}:00.000Z`,distributed=item.state!=='assigned';
    inserted+=Number(await insertOwned(db,'dispatch_assignments',{
     id:item.id,booking_uuid:item.id,service_date:item.date,dispatch_time:item.time,garage:a.garage,delivery_type:'Inhouse',
     vehicle_id:a.vehicleId,driver_id:a.driverId,helper_ids:a.helperIds,state:'CONFIRMED',
     confirm_command_id:seedId('assignment-command',item.index),booking_version:1,created_at:timestamp,updated_at:timestamp,
    },item.id));
    await insertOwned(db,'dispatch_job_orders',{
     id:item.id,job_order_no:`DEMO-JO-${String(item.index+1).padStart(4,'0')}`,booking_uuid:item.id,
     booking_id_alias:`DEMO-WL-${String(item.index+1).padStart(4,'0')}`,client:`DEMO Client ${String(item.index+1).padStart(3,'0')}`,
     service_date:item.date,truck:a.plate,team:[a.driverName,...a.helperNames].join(', '),total_amount:item.amount,
     status:distributed?'Distributed':'Pending',state:'ACTIVE',generated_at:timestamp,created_at:timestamp,updated_at:timestamp,
    },item.id);
   }
  });console.log(JSON.stringify({owner:'dispatch',inserted,preservedScenarios:excluded.size}));
 }finally{await db.end();}
}
main().catch(reportSeedFailure);
