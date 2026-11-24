import { assertSeedAllowed } from './seed-guard.mjs';
assertSeedAllowed();
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
const { people } = JSON.parse(
  await readFile(
    new URL("../prisma/seeds/people.json", import.meta.url),
    "utf8",
  ),
);
const drivers = people.filter((p) => p.group === "driver");
const helpers = people.filter((p) => p.group === "helper");
if (drivers.length !== 12 || helpers.length !== 20)
  throw new Error("Crew manifest must contain 12 drivers and 20 helpers");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  // Spec bms/0012: a crew row is only the BMS details of an account; name, email and contact
  // number stay in Auth. Each row is found by its account, so a rerun changes nothing it set before.
  for (const [i, p] of drivers.entries())
    await db.query(
      `INSERT INTO drivers(id,user_id,license_number,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(user_id) DO NOTHING`,
      [randomUUID(), p.id, `DEMO-${i + 1}`],
    );
  for (const p of helpers)
    await db.query(
      `INSERT INTO helpers(id,user_id,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO NOTHING`,
      [randomUUID(), p.id],
    );
  await db.query("COMMIT");
  console.log(
    "Crew seed complete (12 drivers, 20 helpers); existing profiles preserved.",
  );
} catch {
  await db.query("ROLLBACK");
  throw new Error("Crew seed failed");
} finally {
  await db.end();
}
