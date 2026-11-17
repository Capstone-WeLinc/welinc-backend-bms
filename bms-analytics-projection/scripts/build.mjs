import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const name of ['worker.mjs','config.mjs'])await copyFile(name,'dist/'+name);
