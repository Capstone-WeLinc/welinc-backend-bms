import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run CI commands through npm run');
const projects=['bms-gateway','bms-booking-service','bms-dispatch-service','bms-completion-service','bms-analytics-projection'];
const task=process.argv[2];
const args=task==='install'?['ci']:task==='audit'?['audit','--omit=dev','--audit-level=high']:['run',task];
for(const project of projects){
 console.log(`Checking ${project}: ${task}`);
 const result=spawnSync(process.execPath,[npm,...args],{cwd:root+project,stdio:'inherit',env:process.env});
 if(result.status!==0)process.exit(result.status??1);
}
