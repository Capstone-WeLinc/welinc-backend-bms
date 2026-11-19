import {assertSeedAllowed} from './seed-guard.mjs';
import {reportSeedFailure,seedError} from './demo-common.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const workspace=fileURLToPath(new URL('../../',import.meta.url));
const compose=resolve(workspace,'docker-compose.bms.yml');
function run(service,args,{json=false,input}={}){
 const env=[];
 if(process.env.SEED_ALLOW)env.push('-e',`SEED_ALLOW=${process.env.SEED_ALLOW}`);
 const result=spawnSync('docker',['compose','-f',compose,'exec','-T',...env,service,...args],{
  cwd:workspace,encoding:'utf8',input:input===undefined?undefined:JSON.stringify(input),maxBuffer:8*1024*1024,
 });
 if(result.status!==0){if(result.stderr)process.stderr.write(result.stderr);throw seedError('SEED_PHASE_FAILED_'+service.toUpperCase().replaceAll('-','_'));}
 if(json){try{return JSON.parse(result.stdout);}catch{throw seedError('INVALID_SEED_PHASE_RESPONSE');}}
 if(result.stdout)process.stdout.write(result.stdout);
}
async function main(){
 assertSeedAllowed();
 // Shared setup can call these owner baseline seeds in any order. Full demo phases are ordered here.
 for(const service of ['bms-booking','bms-dispatch','bms-completion','bms-analytics'])run(service,['npm','run','seed','--silent']);
 for(const service of ['bms-booking','bms-dispatch','bms-completion','bms-analytics'])run(service,['node','-e',"fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready',{signal:AbortSignal.timeout(2500)}).then(response=>{if(!response.ok)throw new Error();}).catch(()=>{console.error('SEED_SERVICE_NOT_READY');process.exitCode=1;})"]);
 let manifest=run('bms-booking',['node','scripts/seed-demo.mjs','load'],{json:true});
 if(!manifest){
  const candidate=run('bms-dispatch',['node','scripts/seed-resources.mjs'],{json:true});
  manifest=run('bms-booking',['node','scripts/seed-demo.mjs','plan'],{json:true,input:candidate});
 }
 const changed=new Set();
 for(const service of ['bms-booking','bms-dispatch','bms-completion']){
  for(const id of run(service,['node','scripts/seed-demo.mjs','inspect'],{json:true}))changed.add(id);
 }
 manifest={...manifest,excludedBookingIds:[...changed]};
 for(const service of ['bms-booking','bms-dispatch','bms-completion'])run(service,['node','scripts/seed-demo.mjs','apply'],{input:manifest});
 run('bms-analytics-projection',['npm','run','once','--silent']);
 run('bms-booking',['node','scripts/seed-demo.mjs','complete'],{input:manifest});
 console.log(`BMS demo seed complete; ${changed.size} edited scenarios preserved. No auth accounts or VMMS vehicles were created.`);
}
main().catch(reportSeedFailure);
