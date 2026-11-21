import {assertSeedAllowed} from './seed-guard.mjs';
import {readManifest,scenarios,seedId,insertOwned,editedBookings,transaction,seedError,reportSeedFailure} from './demo-common.mjs';
import pg from 'pg';

async function main(){
 assertSeedAllowed();const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  if(process.argv[2]==='inspect'){console.log(JSON.stringify(await editedBookings(db)));return;}
  const manifest=await readManifest(),excluded=new Set(manifest.excludedBookingIds??[]);
  const items=scenarios(manifest.anchor).filter(r=>!excluded.has(r.id)&&r.state==='completed');
  let inserted=0;
  await transaction(db,async()=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['bms-demo-v1']);
   for(const item of items){
    const a=manifest.allocations[item.id];if(!a)throw seedError('DEMO_ALLOCATION_REQUIRED');
    const alias=`DEMO-WL-${String(item.index+1).padStart(4,'0')}`,number=`DEMO-BN-${String(item.index+1).padStart(4,'0')}`;
    const timestamp=`${item.date}T${Number(item.time.slice(0,2))+2}:00:00.000Z`;
    const client=`DEMO Client ${String(item.index+1).padStart(3,'0')}`;
    inserted+=Number(await insertOwned(db,'work_outcomes',{
     booking_uuid:item.id,booking_id_alias:alias,booking_no:number,client,service:item.service,service_date:item.date,
     amount_due:item.amount,status:'COMPLETED',post_service_status:'Finalized',arrival_time:item.time,
     completion_notes:'[BMS DEMO v1] Completed demonstration job.',finalized_by:manifest.actors.cs,finalized_at:timestamp,
     confirm_command_id:seedId('work-command',item.index),booking_version:2,created_at:timestamp,updated_at:timestamp,
    },item.id));
    if(item.payment==='unpaid')continue;
    const collectionId=seedId('collection',item.index),verified=item.payment!=='pending';
    await insertOwned(db,'collections',{
     id:collectionId,idempotency_key:seedId('collection-request',item.index),booking_uuid:item.id,booking_id_alias:alias,
     booking_no:number,client_name:client,garage:a.garage,delivery_type:'Inhouse',plate_number:a.plate,
     assigned_team:[a.driverName,...a.helperNames].join(', '),amount:item.payment==='partial'?item.amount/2:item.amount,
     method:['Cash','GCash','BDO'][item.index%3],reference:`DEMO-PAY-${item.index+1}`,
     collected_at:timestamp,business_date:item.date,status:verified?'VERIFIED':'PENDING',recorded_by:manifest.actors.cs,
     verified_by:verified?manifest.actors.admin:null,verified_at:verified?timestamp:null,
     payment_command_id:verified?seedId('payment-command',item.index):null,payment_expected_version:verified?3:null,submitted_at:timestamp,created_at:timestamp,
    },item.id);
    await insertOwned(db,'approval_audit_events',{
     id:seedId('collection-audit',item.index),item_type:'collection',item_id:collectionId,actor_id:verified?manifest.actors.admin:manifest.actors.cs,
     action:verified?'verified':'submitted',reason:'BMS demo seed',created_at:timestamp,
    },item.id);
    if(item.payment==='refunded'){
     const refundId=seedId('refund',item.index),requestId=seedId('refund-request',item.index);
     await insertOwned(db,'refunds',{
      id:refundId,idempotency_key:seedId('refund-payment',item.index),collection_id:collectionId,amount:item.amount/4,
      reason:'[BMS DEMO v1] Demonstration partial refund',refunded_at:timestamp,business_date:item.date,approved_by:manifest.actors.admin,
      payment_command_id:seedId('refund-command',item.index),payment_expected_version:4,desired_payment_hold:true,projection_state:'SYNCED',created_at:timestamp,
     },item.id);
     await insertOwned(db,'refund_requests',{
      id:requestId,collection_id:collectionId,booking_uuid:item.id,booking_no:number,client_name:client,amount:item.amount/4,
      reason:'[BMS DEMO v1] Demonstration partial refund',status:'Refunded',requested_by:manifest.actors.cs,requested_at:timestamp,
      decided_by:manifest.actors.admin,decided_at:timestamp,decision_reason:'BMS demo seed',refund_id:refundId,
     },item.id);
    }
   }
   // A real existing daily submission always wins; never overwrite its actor or time.
   for(const day of new Set(items.map(i=>i.date))){
    const jobs=items.filter(i=>i.date===day);
    if(jobs.some(i=>i.payment==='pending')||!jobs.some(i=>['partial','paid','refunded'].includes(i.payment)))continue;
    await insertOwned(db,'daily_submissions',{date:day,submitted_at:`${day}T23:00:00.000Z`,submitted_by:manifest.actors.cs},jobs[0].id);
   }
  });console.log(JSON.stringify({owner:'completion',inserted,preservedScenarios:excluded.size}));
 }finally{await db.end();}
}
main().catch(reportSeedFailure);
