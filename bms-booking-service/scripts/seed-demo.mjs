import {assertSeedAllowed} from './seed-guard.mjs';
import {DATASET,readManifest,scenarios,seedId,insertOwned,editedBookings,transaction,seedError,reportSeedFailure} from './demo-common.mjs';
import {createHash} from 'node:crypto';
import pg from 'pg';

async function main(){
 assertSeedAllowed();
 const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  const action=process.argv[2]??'apply';
  if(action==='load'){const result=await db.query('SELECT manifest FROM bms_demo_seed_runs WHERE dataset_key=$1',[DATASET]);console.log(JSON.stringify(result.rows[0]?.manifest??null));return;}
  if(action==='inspect'){console.log(JSON.stringify(await editedBookings(db)));return;}
  const manifest=await readManifest();
  if(action==='plan'){
   const saved=await transaction(db,async()=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[DATASET]);
    await db.query('INSERT INTO bms_demo_seed_runs(dataset_key,manifest) VALUES($1,$2) ON CONFLICT(dataset_key) DO NOTHING',[DATASET,manifest]);
    return (await db.query('SELECT manifest FROM bms_demo_seed_runs WHERE dataset_key=$1',[DATASET])).rows[0].manifest;
   });console.log(JSON.stringify(saved));return;
  }
  if(action==='complete'){await db.query("UPDATE bms_demo_seed_runs SET phase='complete',updated_at=now() WHERE dataset_key=$1",[DATASET]);console.log(JSON.stringify({status:'complete'}));return;}
  if(action!=='apply')throw seedError('INVALID_SEED_ACTION');
  const excluded=new Set(manifest.excludedBookingIds??[]);let inserted=0;
  await transaction(db,async()=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[DATASET]);
   for(const item of scenarios(manifest.anchor)){
    if(excluded.has(item.id))continue;
    const assigned=['assigned','distributed','completed'].includes(item.state),completed=item.state==='completed';
    const paidHold=completed&&['partial','paid','refunded'].includes(item.payment),refunded=item.payment==='refunded';
    const timestamp=`${item.date}T${item.time}:00.000Z`;
    const allocation=manifest.allocations[item.id];
    if(assigned&&!allocation)throw seedError('DEMO_ALLOCATION_REQUIRED');
    inserted+=Number(await insertOwned(db,'bookings',{
     id:item.id,booking_id:`DEMO-WL-${String(item.index+1).padStart(4,'0')}`,booking_no:`DEMO-BN-${String(item.index+1).padStart(4,'0')}`,
     client:`DEMO Client ${String(item.index+1).padStart(3,'0')}`,full_name:`DEMO Customer ${item.index+1}`,
     service:item.service,service_type:item.service,date:item.date,preferred_time:item.time,
     pickup_address:'Quezon City Hall, Quezon City',delivery_address:'SM North EDSA, Quezon City',delivery_location:'NC — NCR to NCR',
     amount:item.amount,notes:`[BMS DEMO v1] ${item.state}; ${item.payment}`,email:null,contact:null,
     status:completed?'Completed':item.state==='cancelled'?'Cancelled':assigned?'Assigned':'For Plotting',
     version:completed?3+Number(paidHold)+Number(refunded):assigned?2:1,
     operational_hold:assigned,payment_hold:paidHold,assignment_reference:assigned?item.id:null,
     created_at:timestamp,updated_at:timestamp,
    },item.id));
    const command=async(kind,key,expectedVersion,extra,status)=>{
     const commandId=seedId(key,item.index);
     const input={commandId,kind,expectedVersion,...extra};
     await insertOwned(db,'internal_booking_commands',{
      command_id:commandId,booking_uuid:item.id,kind,
      payload_hash:createHash('sha256').update(JSON.stringify({id:item.id,input})).digest('hex'),
      result:{applied:true,duplicate:false,bookingId:item.id,version:expectedVersion+1,status},created_at:timestamp,
     },item.id);
    };
    if(assigned)await command('ConfirmAssignment','assignment-command',1,{reference:item.id,actor:manifest.actors.ops},'Assigned');
    if(completed)await command('ConfirmWorkCompletion','work-command',2,{},'Completed');
    if(paidHold)await command('SetPaymentHold','payment-command',3,{paymentHold:true},'Completed');
    if(refunded)await command('SetPaymentHold','refund-command',4,{paymentHold:true},'Completed');
    if(assigned)await insertOwned(db,'approval_audit_events',{id:seedId('booking-audit',item.index),item_type:'booking',item_id:item.id,actor_id:manifest.actors.ops,action:'assigned',reason:'BMS demo seed',created_at:timestamp},item.id);
   }
   await db.query("UPDATE bms_demo_seed_runs SET phase='booking',updated_at=now() WHERE dataset_key=$1",[DATASET]);
  });
  console.log(JSON.stringify({owner:'booking',inserted,preservedScenarios:excluded.size}));
 }finally{await db.end();}
}
main().catch(reportSeedFailure);
