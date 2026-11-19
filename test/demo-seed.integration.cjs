// Real owned databases/services, with contract-controlled auth and VMMS upstreams.
// Requires the six production/seed images to be built. Never uses a project's .env.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createServer}=require('node:http');
const {randomUUID}=require('node:crypto');
const {readFileSync,mkdtempSync,rmdirSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=path.resolve(__dirname,'..');
const pg=require(path.join(root,'bms-booking-service/node_modules/pg'));
const {testSigner,signAccess}=require(path.join(root,'bms-dispatch-service/dist/src/auth/verify/testing/test-auth.js'));
const {exportJWK,decodeJwt}=require(path.join(root,'bms-dispatch-service/node_modules/jose'));
const owners={booking:{folder:'bms-booking-service',port:5434},dispatch:{folder:'bms-dispatch-service',port:5435},completion:{folder:'bms-completion-service',port:5436},analytics:{folder:'../welinc-backend-bms-analytics-ai',port:5437}};
function command(executable,args,options={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd:root,env:process.env,...options,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));
  child.stdin.end(options.input??'');
 });
}
async function checked(executable,args,options={}){
 const result=await command(executable,args,options);
 assert.equal(result.status,0,`${path.basename(args[0]??executable)} failed: ${result.stderr.slice(-1800)} ${result.stdout.slice(-800)}`);
 return result.stdout;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

test('full demo seeds resume, preserve edits, project without DDL and obey service pool budgets',{timeout:600000},async()=>{
 const suffix=Date.now().toString(36),created=[],apps=[];
 const temp=mkdtempSync(path.join(os.tmpdir(),'bms-hosting-test-'));
 const upstreamSigner=await testSigner('seed-auth-fixture'),clientSigner=await testSigner('seed-bms-fixture'),analyticsSigner=await testSigner('seed-analytics-fixture');
 const clientKey=JSON.stringify({...await exportJWK(clientSigner.privateKey),kid:clientSigner.kid,alg:'ES256'});
 const analyticsKey=JSON.stringify({...await exportJWK(analyticsSigner.privateKey),kid:analyticsSigner.kid,alg:'ES256'});
 const {people}=JSON.parse(readFileSync(path.join(root,'bms-dispatch-service/prisma/seeds/people.json'),'utf8'));
 const admin=people.find(p=>p.state==='active'&&p.roles.some(r=>r.system==='BMS'&&r.role==='ADMIN'));
 const vehicle={id:'12345678-1234-4123-a123-123456789abc',plateNumber:'TEST-VMMS-001',make:'Test',model:'Contract truck',year:2026,truckSizeCategory:'10ft. Closed Van',capacity:1000,odometer:10,status:'AVAILABLE',garageId:'22345678-1234-4123-a123-123456789abc',updatedAt:new Date().toISOString()};
 let fleetOnline=false,freshReads=0,tokenRequests=0;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');let raw='';for await(const chunk of req)raw+=chunk;
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/auth/token'){
   tokenRequests++;const form=new URLSearchParams(raw),aud=form.get('audience');
   assert(['VMMS','AUTH'].includes(aud));assert.equal(form.get('scope'),aud==='VMMS'?'fleet.read':'directory.read');
   return send(200,{access_token:`fixture-${aud}`,expires_in:3600});
  }
  if(url.pathname==='/auth/.well-known/jwks.json')return send(200,upstreamSigner.jwks);
  if(url.pathname==='/auth/session'){
   const claims=decodeJwt(String(req.headers.authorization).replace(/^Bearer /,''));
   const caller=people.find(p=>p.id===claims.sub);
   return caller?send(200,{active:true,expiresAt:new Date(Date.now()+3600000).toISOString(),user:{id:caller.id,name:caller.name,email:caller.email}}):send(401,{code:'SESSION_ENDED'});
  }
  if(url.pathname==='/auth/directory/users/lookup'){
   assert.equal(req.headers.authorization,'Bearer fixture-AUTH');
   const {ids}=JSON.parse(raw);return send(200,{users:people.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,name:p.name,email:p.email,roles:p.roles.filter(r=>r.system==='BMS').map(r=>r.role),temporaryRoles:[],isActive:p.state==='active',deleted:false,erased:false})),missing:ids.filter(id=>!people.some(p=>p.id===id))});
  }
  if(url.pathname.startsWith('/vmms/fleet/')){
   if(!fleetOnline)return send(503,{code:'FLEET_UNAVAILABLE'});
   assert.equal(req.headers.authorization,'Bearer fixture-VMMS');
   if(url.pathname==='/vmms/fleet/vehicles')return send(200,{vehicles:[vehicle]});
   if(url.pathname==='/vmms/fleet/garages')return send(200,{garages:[{id:vehicle.garageId,name:'Contract test garage'}]});
   freshReads++;return send(200,vehicle);
  }
  return send(404,{code:'NOT_FOUND'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const upstream=`http://127.0.0.1:${server.address().port}`;
 const endpoints={};for(const owner of Object.keys(owners))endpoints[owner]=`http://127.0.0.1:${await freePort()}`;
 const base={...process.env,NODE_ENV:'test',SEED_ALLOW:'',BMS_SEED_MANIFEST:'',BMS_SEED_ANCHOR_DATE:'',DB_POOL_MAX:'2',
  AUTH_CLIENT_ID:'bms',AUTH_CLIENT_PRIVATE_KEY:clientKey,AUTH_ISSUER:upstream+'/auth',AUTH_JWKS_URL:upstream+'/auth/.well-known/jwks.json',AUTH_INTERNAL_URL:upstream,
  VMMS_INTERNAL_URL:upstream,BMS_INTERNAL_SERVICE_KEY:'test-only-internal-key-not-a-real-secret-123',CUSTOMER_TRACKING_SECRET:'test-only-tracking-key-not-a-real-secret-123',
  BOOKING_API_URL:endpoints.booking,DISPATCH_API_URL:endpoints.dispatch,COMPLETION_API_URL:endpoints.completion,
  SMTP_HOST:'',SMTP_USER:'',SMTP_PASS:'',GROQ_API_KEY:'',CORS_ORIGINS:'',GOOGLE_MAPS_API_KEY:'',GOOGLE_GEOCODING_API_KEY:'',
 };
 const configs={};
 async function query(owner,sql,values=[]){const db=new pg.Client({connectionString:configs[owner].url});await db.connect();try{return await db.query(sql,values);}finally{await db.end();}}
 async function cli(owner,script,args=[],manifest,extra={}){
  return command(process.execPath,[path.resolve(root,owners[owner].folder,script),...args],{cwd:temp,env:{...base,DATABASE_URL:configs[owner].url,...extra},input:manifest===undefined?'':JSON.stringify(manifest)});
 }
 async function phase(owner,action,manifest){const r=await cli(owner,'scripts/seed-demo.mjs',[action],manifest);assert.equal(r.status,0,`${owner}/${action}: ${r.stderr}`);return JSON.parse(r.stdout);}
 async function counts(){const result={};for(const owner of ['booking','dispatch','completion'])result[owner]=(await query(owner,'SELECT COUNT(*)::int n FROM bms_demo_seed_records')).rows[0].n;return result;}
 let manifest,projectionRole;
 try{
  for(const [owner,settings] of Object.entries(owners)){
   const dbName=`bms_hosting_test_${suffix}_${owner}`;assert.match(dbName,/^bms_hosting_test_[a-z0-9_]+$/);
   await checked('docker',['exec',`welinc_bms_${owner}_db`,'createdb','-U','bms_user',dbName]);created.push(owner);
   configs[owner]={dbName,url:`postgresql://bms_user:bms_pass@127.0.0.1:${settings.port}/${dbName}`};
   const internal=`postgresql://bms_user:bms_pass@bms-${owner}-db:5432/${dbName}`;
   // A hosted migration job needs only DATABASE_URL; no auth key or seed permission.
   await checked('docker',['run','--rm','--network','welinc-network','-e',`DATABASE_URL=${internal}`,`welinc-bms-${owner}-seed:hosting-check`,'npx','prisma','migrate','deploy']);
   console.log('Migrated isolated '+owner+' database with DATABASE_URL only.');
  }
  const cleanupCheck=new pg.Client({connectionString:configs.dispatch.url});
  await cleanupCheck.connect();
  try {
   await cleanupCheck.query('BEGIN');
   await cleanupCheck.query('CREATE TEMP TABLE helpers (LIKE public.helpers INCLUDING DEFAULTS) ON COMMIT DROP; CREATE TEMP TABLE dispatch_assignments (helper_ids text[]) ON COMMIT DROP; CREATE TEMP TABLE dispatch_job_orders (team text) ON COMMIT DROP');
   const fixtures=[['HLP-001','Jose Ramos','JR',null,false],['HLP-002','Pedro Garcia','PG',null,true],['HLP-003','Miguel Torres','MT',null,false],['HLP-001','Jose Ramos','JR',randomUUID(),false]];
   const ids=[];
   for(const [emp,name,initials,user,edited] of fixtures){const id=randomUUID();ids.push(id);await cleanupCheck.query("INSERT INTO helpers(id,emp_id,name,initials,user_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'2020-01-01',$6)",[id,emp,name,initials,user,edited?'2020-01-02':'2020-01-01']);}
   await cleanupCheck.query('INSERT INTO dispatch_assignments(helper_ids) VALUES($1)',[[ids[2]]]);
   await cleanupCheck.query(readFileSync(path.join(root,'bms-dispatch-service/prisma/migrations/20261117000000_remove_untouched_demo_helpers/migration.sql'),'utf8'));
   assert.deepEqual((await cleanupCheck.query('SELECT id FROM helpers ORDER BY id')).rows.map(r=>r.id),ids.slice(1).sort(),'cleanup removes only the untouched, unused and unlinked example');
  } finally {await cleanupCheck.query('ROLLBACK');await cleanupCheck.end();}
  for(const owner of Object.keys(owners)){
   const script=owner==='dispatch'?'scripts/seed-crew.mjs':'prisma/seed.mjs';
   const result=await cli(owner,script);assert.equal(result.status,0,result.stderr);
   const blocked=await cli(owner,script,[],undefined,{NODE_ENV:'production',SEED_ALLOW:''});assert.notEqual(blocked.status,0,'production baseline seed must refuse');
  }
  assert.equal((await query('dispatch','SELECT count(*)::int n FROM drivers')).rows[0].n,12);
  assert.equal((await query('dispatch','SELECT count(*)::int n FROM helpers')).rows[0].n,20);
  const unavailable=await cli('dispatch','scripts/seed-resources.mjs');assert.notEqual(unavailable.status,0);assert.match(unavailable.stderr,/FLEET_UNAVAILABLE/);
  assert.equal((await query('booking','SELECT count(*)::int n FROM bookings')).rows[0].n,0,'fleet preflight must not invent operational fixtures');
  fleetOnline=true;
  const resources=await cli('dispatch','scripts/seed-resources.mjs');assert.equal(resources.status,0,resources.stderr);
  manifest=await phase('booking','plan',JSON.parse(resources.stdout));
  await phase('booking','apply',manifest);await phase('dispatch','apply',manifest);
  assert.equal((await query('completion','SELECT count(*)::int n FROM work_outcomes')).rows[0].n,0,'simulate interruption before completion phase');
  // Resume all phases: completed owners do not duplicate their work.
  for(const owner of ['booking','dispatch','completion'])await phase(owner,'apply',manifest);
  const initial=await counts();
  for(const owner of ['booking','dispatch','completion'])await phase(owner,'apply',manifest);
  assert.deepEqual(await counts(),initial);
  console.log('Verified repeatable owner seed phases and interrupted-run recovery.');
  const {scenarios,seedId}=await import('../scripts/demo-common.mjs');
  const planned=scenarios(manifest.anchor),completed=planned.filter(r=>r.state==='completed');
  assert.equal((await query('booking','SELECT count(*)::int n FROM bookings')).rows[0].n,150);
  assert.equal((await query('completion',"SELECT count(*)::int n FROM work_outcomes WHERE status='COMPLETED'")).rows[0].n,completed.length);
  assert(freshReads>0);assert(tokenRequests>0);
  for(const [owner,settings] of Object.entries(owners)){
   const folder=path.resolve(root,settings.folder),entry=owner==='analytics'?'dist/src/main.js':'dist/src/main.js';
   const child=spawn(process.execPath,[path.join(folder,entry)],{cwd:temp,env:{...base,DATABASE_URL:configs[owner].url,PORT:new URL(endpoints[owner]).port,AUTH_CLIENT_ID:owner==='analytics'?'bms-analytics':'bms',AUTH_CLIENT_PRIVATE_KEY:owner==='analytics'?analyticsKey:clientKey},stdio:['ignore','pipe','pipe']});
   let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);apps.push(child);
   let ready=false;const deadline=Date.now()+90000;
   while(Date.now()<deadline){try{ready=(await fetch(endpoints[owner]+'/health/ready',{signal:AbortSignal.timeout(2500)})).ok;}catch{ready=false;}if(ready)break;if(child.exitCode!==null)break;await pause(500);}
   assert(ready,`${owner} did not become ready (exit ${child.exitCode}): ${output.slice(-1500)}`);
   console.log('Started real '+owner+' API; database readiness passed.');
  }
  const token=await signAccess(upstreamSigner,{iss:base.AUTH_ISSUER,sub:admin.id,email:admin.email,roles:[{system:'BMS',role:'ADMIN'}],sid:randomUUID(),jti:randomUUID(),client_id:'bms'});
  const storage=await cli('analytics','test/storage-contract.cjs');assert.equal(storage.status,0,storage.stderr+' '+storage.stdout);
  const reportResponse=await fetch(endpoints.analytics+`/reports/operational?from=${planned[0].date}&to=${planned.at(-1).date}`,{headers:{authorization:`Bearer ${token}`}});
  const report=await reportResponse.json();assert.equal(reportResponse.status,200,JSON.stringify(report));
  assert.equal(report.totals.bookings,planned.filter(r=>r.state!=='cancelled').length);assert.equal(report.totals.completed,completed.length);
  const unassigned=planned.find(r=>r.state==='unassigned'),allocation=Object.values(manifest.allocations)[0];
  const ops=people.find(p=>p.id===manifest.actors.ops);
  const opsToken=await signAccess(upstreamSigner,{iss:base.AUTH_ISSUER,sub:ops.id,email:ops.email,roles:[{system:'BMS',role:'OPERATIONS'}],sid:randomUUID(),jti:randomUUID(),client_id:'bms'});
  vehicle.status='UNDER_MAINTENANCE';
  const denied=await fetch(endpoints.dispatch+`/scheduling/${unassigned.id}/assign`,{method:'PUT',headers:{authorization:`Bearer ${opsToken}`,'content-type':'application/json'},body:JSON.stringify({vehicleId:vehicle.id,driverId:allocation.driverId,helperIds:allocation.helperIds,dispatchTime:'08:00',garage:allocation.garage,deliveryType:'Inhouse'})});
  const denial=await denied.json();assert.equal(denied.status,409,JSON.stringify(denial));assert.equal(denial.code,'VEHICLE_UNAVAILABLE');vehicle.status='AVAILABLE';
  projectionRole=`bms_projection_test_${suffix}`;assert.match(projectionRole,/^bms_projection_test_[a-z0-9]+$/);
  await query('analytics',`CREATE ROLE ${projectionRole} LOGIN PASSWORD 'test-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await query('analytics',`GRANT USAGE ON SCHEMA public TO ${projectionRole}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${projectionRole}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${projectionRole}`);
  const restricted=`postgresql://${projectionRole}:test-only-password@127.0.0.1:5437/${configs.analytics.dbName}`;
  const projection = (databaseSettings) => checked(
   process.execPath,
   [path.join(root, 'bms-analytics-projection/worker.mjs'), '--once'],
   {
    cwd: temp,
    env: { ...base, DATABASE_URL: '', ANALYTICS_READ_MODEL_DATABASE_URL: '', ...databaseSettings },
   },
  );
  await projection({ DATABASE_URL: restricted });
  await projection({ ANALYTICS_READ_MODEL_DATABASE_URL: restricted });
  assert.equal((await query('analytics','SELECT count(*)::int n FROM bookings')).rows[0].n,150);
  assert.equal((await query('analytics','SELECT count(*)::int n FROM bms_projection_rows')).rows[0].n,150);
  const expectedPaid=completed.reduce((sum,r)=>sum+(r.payment==='partial'?r.amount/2:r.payment==='paid'?r.amount:r.payment==='refunded'?r.amount*0.75:0),0);
  assert.equal(Number((await query('analytics','SELECT sum(amount_paid) n FROM bookings')).rows[0].n),expectedPaid);
  for(const owner of Object.keys(owners))assert((await query(owner,'SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database()')).rows[0].n<=3,'runtime pool plus the test inspector stays bounded');
  const changed=planned.find(r=>r.payment==='partial'&&r.state==='completed');
  await query('booking',"UPDATE bookings SET client='Edited demo customer' WHERE id=$1",[changed.id]);
  await query('completion','UPDATE collections SET amount=amount+25 WHERE id=$1',[seedId('collection',changed.index)]);
  const exclusions=new Set();for(const owner of ['booking','dispatch','completion'])for(const id of await phase(owner,'inspect'))exclusions.add(id);
  assert(exclusions.has(changed.id));const edited={...manifest,excludedBookingIds:[...exclusions]};
  for(const owner of ['booking','dispatch','completion'])await phase(owner,'apply',edited);
  assert.equal((await query('booking','SELECT client FROM bookings WHERE id=$1',[changed.id])).rows[0].client,'Edited demo customer');
  assert.equal(Number((await query('completion','SELECT amount FROM collections WHERE id=$1',[seedId('collection',changed.index)])).rows[0].amount),changed.amount/2+25);
  const unavailableRow=planned.find(r=>r.state==='unassigned');await query('booking','DELETE FROM bookings WHERE id=$1',[unavailableRow.id]);
  const removed=await phase('booking','inspect');assert(removed.includes(unavailableRow.id));
  await phase('booking','apply',{...edited,excludedBookingIds:[...new Set([...exclusions,...removed])]});
  assert.equal((await query('booking','SELECT count(*)::int n FROM bookings WHERE id=$1',[unavailableRow.id])).rows[0].n,0,'manual deletion is preserved');
  console.log('Verified 150 demo scenarios, restart/resume, edit/deletion preservation, real owned APIs/reports, restricted-role projection and connection budgets.');
 }finally{
  for(const child of apps)child.kill('SIGTERM');await pause(500);
  const closeServer=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closeServer;
  for(const owner of created.reverse()){
   const name=configs[owner].dbName;assert.match(name,/^bms_hosting_test_[a-z0-9_]+$/);
   await checked('docker',['exec',`welinc_bms_${owner}_db`,'psql','-U','bms_user','-d','postgres','-c',`DROP DATABASE "${name}" WITH (FORCE)`]);
  }
  if(projectionRole)await checked('docker',['exec','welinc_bms_analytics_db','psql','-U','bms_user','-d','postgres','-c',`DROP ROLE ${projectionRole}`]);
  assert.equal(path.dirname(temp),os.tmpdir());try{rmdirSync(temp);}catch{/* Retain any diagnostic artifact rather than recursively deleting it. */}
 }
});
