import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scenarios,seedId} from '../scripts/demo-common.mjs';
test('default demo has 150 deterministic scenarios and 90 days of balanced service history',()=>{
 const rows=scenarios('2026-11-17');assert.equal(rows.length,150);assert.equal(new Set(rows.map(r=>r.id)).size,150);
 const history=rows.slice(0,144);assert.equal(new Set(history.map(r=>r.date)).size,90);
 assert.equal(history[0].date,'2026-08-19');assert.equal(history.at(-1).date,'2026-11-16');
 for(const service of new Set(history.map(r=>r.service)))assert.equal(history.filter(r=>r.service===service).length,36);
 for(const payment of ['unpaid','pending','partial','paid','refunded'])assert(history.some(r=>r.state==='completed'&&r.payment===payment));
 assert.equal(rows[148].state,'distributed');assert.equal(rows[148].date,'2026-11-17');
 assert.match(seedId('booking',0),/^[0-9a-f-]{36}$/);assert.equal(seedId('booking',0),rows[0].id);
 assert.notEqual(seedId('booking',0),seedId('collection',0));
});
test('owner seed images carry the identical versioned manifest and preservation rules',async()=>{
 const common=await readFile(new URL('../scripts/demo-common.mjs',import.meta.url),'utf8');
 for(const owner of ['bms-booking-service','bms-dispatch-service','bms-completion-service'])assert.equal(await readFile(new URL('../'+owner+'/scripts/demo-common.mjs',import.meta.url),'utf8'),common);
});
