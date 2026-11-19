import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSeedAllowed} from '../scripts/seed-guard.mjs';
test('production seeds require the staging-only override',()=>{assert.throws(()=>assertSeedAllowed({NODE_ENV:'production'}),/blocked/);assert.throws(()=>assertSeedAllowed({NODE_ENV:'production',SEED_ALLOW:'production'}),/blocked/);assert.doesNotThrow(()=>assertSeedAllowed({NODE_ENV:'production',SEED_ALLOW:'staging'}));assert.doesNotThrow(()=>assertSeedAllowed({NODE_ENV:'development'}));});
