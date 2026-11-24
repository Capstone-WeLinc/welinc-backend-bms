import 'reflect-metadata';
import {assertSeedAllowed} from './seed-guard.mjs';
import {DATASET,scenarios,readManifest,seedError,reportSeedFailure} from './demo-common.mjs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import pg from 'pg';
const require=createRequire(import.meta.url);

async function main(){
  assertSeedAllowed();
  const {AssertionSigner,ServiceTokenClient}=require('../dist/src/auth/verify');
  const {DirectoryClient}=require('../dist/src/auth/directory.client');
  const issuer=process.env.AUTH_ISSUER, internalUrl=process.env.AUTH_INTERNAL_URL;
  const signer=await AssertionSigner.create({clientId:'bms',privateKey:process.env.AUTH_CLIENT_PRIVATE_KEY,issuer});
  const fleetTokens=new ServiceTokenClient({tokenUrl:`${internalUrl}/auth/token`,signer,audience:'VMMS',scope:'fleet.read'});
  const directoryTokens=new ServiceTokenClient({tokenUrl:`${internalUrl}/auth/token`,signer,audience:'AUTH',scope:'directory.read'});
  const directory=new DirectoryClient(directoryTokens,{internalUrl});
  const root=process.env.VMMS_INTERNAL_URL;
  async function fleet(path){
    try{return await fleetTokens.withToken(async token=>{
      const response=await fetch(new URL(path,root),{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});
      if(response.status===401 && (await response.clone().json().catch(()=>({}))).code==='TOKEN_EXPIRED'){
        const error=new Error('expired');error.getStatus=()=>401;throw error;
      }
      if(!response.ok)throw seedError('FLEET_UNAVAILABLE');return response.json();
    });}catch{throw seedError('FLEET_UNAVAILABLE_START_VMMS_FIRST');}
  }
  if(process.argv[2]==='verify'){
    const manifest=await readManifest();
    const ids=new Set((manifest.verifyBookingIds??[]).map(id=>manifest.allocations[id]?.vehicleId));
    for(const id of ids){if(!id)throw seedError('DEMO_ALLOCATION_REQUIRED');const v=await fleet(`/vmms/fleet/vehicles/${encodeURIComponent(id)}`);if(v.status!=='AVAILABLE')throw seedError('VMMS_VEHICLE_UNAVAILABLE');}
    console.log(JSON.stringify({status:'ok'}));return;
  }
  const [answer,garagesAnswer]=await Promise.all([fleet('/vmms/fleet/vehicles'),fleet('/vmms/fleet/garages')]);
  const vehicles=answer.vehicles.filter(v=>v.status==='AVAILABLE').sort((a,b)=>a.plateNumber.localeCompare(b.plateNumber));
  if(!vehicles.length)throw seedError('AVAILABLE_VMMS_VEHICLE_REQUIRED');
  // Fresh reads at assignment planning, never a cached list or fabricated fleet.
  for(const v of vehicles){const current=await fleet(`/vmms/fleet/vehicles/${encodeURIComponent(v.id)}`);if(current.status!=='AVAILABLE')throw seedError('VMMS_VEHICLE_CHANGED_RERUN_SEED');}
  const {people}=JSON.parse(await readFile(new URL('../prisma/seeds/people.json',import.meta.url),'utf8'));
  const actor=role=>people.find(p=>p.state==='active'&&p.roles.some(r=>r.system==='BMS'&&r.role===role))?.id;
  const actors={admin:actor('ADMIN'),ops:actor('OPERATIONS'),cs:actor('CUSTOMER_SUPPORT')};
  if(Object.values(actors).some(id=>!id))throw seedError('SUITE_ACTORS_REQUIRED');
  const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
  try{
    const [driversResult,helpersResult,profilesResult,assignmentsResult]=await Promise.all([
      db.query('SELECT id,user_id FROM drivers WHERE is_active AND deleted_at IS NULL AND user_id IS NOT NULL ORDER BY created_at,id'),
      db.query('SELECT id,user_id FROM helpers WHERE is_active AND user_id IS NOT NULL ORDER BY created_at,id'),
      db.query('SELECT vehicle_id,required_helpers FROM vehicle_dispatch_profiles'),
      db.query("SELECT * FROM dispatch_assignments WHERE state IN ('PENDING','CONFIRMED','RELEASING')"),
    ]);
    const identities=await directory.lookup([...driversResult.rows,...helpersResult.rows].map(r=>r.user_id).filter(Boolean).concat(Object.values(actors)));
    const eligible=(row,role)=>{const p=identities.get(row.user_id);return p&&p.isActive&&!p.deleted&&!p.erased&&p.roles.includes(role)&&!(p.temporaryRoles??[]).includes(role);};
    for(const [role,id] of Object.entries(actors)){const p=identities.get(id);const expected={admin:'ADMIN',ops:'OPERATIONS',cs:'CUSTOMER_SUPPORT'}[role];if(!p||!p.isActive||p.deleted||p.erased||!p.roles.includes(expected)||(p.temporaryRoles??[]).includes(expected))throw seedError('ACTIVE_PERMANENT_SUITE_ACTORS_REQUIRED');}
    // Names come from the account (spec bms/0012); the rows hold only BMS details.
    const named=row=>({...row,name:identities.get(row.user_id).name});
    const drivers=driversResult.rows.filter(r=>eligible(r,'DRIVER')).map(named),helpers=helpersResult.rows.filter(r=>eligible(r,'HELPER')).map(named);
    if(!drivers.length||!helpers.length)throw seedError('LINKED_SUITE_CREW_REQUIRED_RUN_BASE_SEEDS');
    const anchor=process.env.BMS_SEED_ANCHOR_DATE||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
    const fixtures=scenarios(anchor),demoIds=new Set(fixtures.map(r=>r.id));
    const existing=assignmentsResult.rows.filter(row=>!demoIds.has(row.booking_uuid));
    const allocations={};
    for(const item of fixtures.filter(r=>!['unassigned','cancelled'].includes(r.state))){
      const busy=existing.filter(row=>row.service_date===item.date);
      const vehicle=vehicles.find(v=>!busy.some(row=>row.vehicle_id===v.id));
      const driver=drivers.find(d=>!busy.some(row=>row.driver_id===d.id));
      const count=Math.max(1,profilesResult.rows.find(p=>p.vehicle_id===vehicle?.id)?.required_helpers??0);
      const crew=helpers.filter(h=>!busy.some(row=>row.helper_ids.includes(h.id))).slice(0,count);
      if(!vehicle||!driver||crew.length<count)throw seedError('DEMO_RESOURCE_CONFLICT_EXISTING_WORK_PRESERVED');
      allocations[item.id]={vehicleId:vehicle.id,plate:vehicle.plateNumber,driverId:driver.id,driverName:driver.name,helperIds:crew.map(h=>h.id),helperNames:crew.map(h=>h.name),garage:garagesAnswer.garages.find(g=>g.id===vehicle.garageId)?.name??'Unassigned'};
    }
    console.log(JSON.stringify({dataset:DATASET,anchor,actors,allocations}));
  }finally{await db.end();}
}
main().catch(reportSeedFailure);
