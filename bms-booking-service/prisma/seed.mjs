import {assertSeedAllowed} from '../scripts/seed-guard.mjs';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
assertSeedAllowed();
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
 await db.query('BEGIN');
 await db.query(await readFile(new URL('./seeds/catalogs.sql',import.meta.url),'utf8'));
 await db.query('COMMIT');
 console.log('Default services, materials and truck rates seeded; existing catalog edits preserved.');
}catch{await db.query('ROLLBACK');throw new Error('Booking catalog seed failed');}finally{await db.end();}
