import { assertSeedAllowed } from '../scripts/seed-guard.mjs';
assertSeedAllowed();
// Catalog/demo fixtures are installed by idempotent Prisma migrations.
console.log('BMS fixtures ready; existing workflow records preserved.');
