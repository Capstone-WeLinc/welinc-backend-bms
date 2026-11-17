import { test } from 'node:test';
import assert from 'node:assert/strict';
import {workerConfig} from '../config.mjs';
test('worker caps its pool and rejects insecure hosted settings',()=>{assert.equal(workerConfig({}).max,2);assert.throws(()=>workerConfig({DB_POOL_MAX:'0'}),/DB_POOL_MAX/);assert.throws(()=>workerConfig({NODE_ENV:'production'}),/BOOKING_API_URL/);});

test('worker accepts the hosted PostgreSQL address and rejects loopback database hosts',()=>{
 const raw={NODE_ENV:'production',BOOKING_API_URL:'https://booking.internal.example.test',DISPATCH_API_URL:'https://dispatch.internal.example.test',COMPLETION_API_URL:'https://completion.internal.example.test',ANALYTICS_READ_MODEL_DATABASE_URL:'postgresql://app:example@psql-welinc-staging.postgres.database.azure.com/db?sslmode=require'};
 assert.equal(workerConfig(raw).max,2);
 for(const host of ['localhost','db.localhost','127.0.0.1','0.0.0.0'])assert.throws(()=>workerConfig({...raw,ANALYTICS_READ_MODEL_DATABASE_URL:`postgresql://app:example@${host}/db?sslmode=require`}),/ANALYTICS_READ_MODEL_DATABASE_URL/);
});
