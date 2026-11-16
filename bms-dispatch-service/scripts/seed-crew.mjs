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
  for (const [i, p] of drivers.entries())
    await db.query(
      `INSERT INTO drivers(id,user_id,emp_id,name,initials,license_number,email,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(emp_id) DO UPDATE SET user_id=COALESCE(drivers.user_id,EXCLUDED.user_id), name=CASE WHEN drivers.user_id IS NULL THEN EXCLUDED.name ELSE drivers.name END, email=CASE WHEN drivers.user_id IS NULL THEN EXCLUDED.email ELSE drivers.email END`,
      [
        randomUUID(),
        p.id,
        `DRV-${String(i + 1).padStart(3, "0")}`,
        p.name,
        p.name
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0])
          .join(""),
        `DEMO-${i + 1}`,
        p.email,
      ],
    );
  for (const [i, p] of helpers.entries())
    await db.query(
      `INSERT INTO helpers(id,user_id,emp_id,name,initials,email,updated_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(emp_id) DO UPDATE SET user_id=COALESCE(helpers.user_id,EXCLUDED.user_id), name=CASE WHEN helpers.user_id IS NULL THEN EXCLUDED.name ELSE helpers.name END, email=CASE WHEN helpers.user_id IS NULL THEN EXCLUDED.email ELSE helpers.email END`,
      [
        randomUUID(),
        p.id,
        `HLP-${String(i + 1).padStart(3, "0")}`,
        p.name,
        p.name
          .split(/\s+/)
          .slice(0, 2)
          .map((x) => x[0])
          .join(""),
        p.email,
      ],
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
