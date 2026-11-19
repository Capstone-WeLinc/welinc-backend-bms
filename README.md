# BMS backend

BMS uses the suite portal and auth service. Its five backend processes run with
Node 24 and npm. Start them with `docker-compose.bms.yml` after the shared
stack. See the [BMS setup guide](../docs/context/bms/setup.md) and
[integration checklist](../docs/context/bms/integration-checklist.md).

| Process | Port | Responsibility |
|---|---|---|
| `bms-gateway` | 3020 | NestJS session host, explicit routing, streamed bodies, work activity |
| `bms-booking-service` | 3021 | Booking, approvals, catalogs, signed webhook, public tracking |
| `bms-dispatch-service` | 3022 | Assignments, local crew and dispatch profiles, VMMS fleet consumer |
| `bms-completion-service` | 3023 | Work outcomes, collections, refunds, daily sales |
| `bms-analytics-projection` | 3024 | Projects BMS service APIs into the separate analytics database |

The separate Analytics API runs in `../welinc-backend-bms-analytics-ai` on 3025.
Browser requests enter through `http://localhost:3000/bms/`. Sign in at
`http://localhost:8000`; the BMS web app is on 8003.

## Configuration and data

`npm ci` here runs `scripts/prepare-local.mjs`. It creates the root environment
file when absent, generates missing BMS internal/tracking secrets, and preserves
existing configuration. It prints no secret values. The shared setup issues the
`bms` client key. Names and local addresses are documented in `.env.example`.
The five processes here receive this root configuration through Compose.
The separate analytics API uses its own `bms-analytics` identity and environment.

Booking, dispatch, completion and analytics each own a PostgreSQL database.
There are no auth or fleet database connections. Dispatch owns drivers, helpers
and `vehicle_dispatch_profiles`; VMMS owns vehicles and garages. An unavailable
VMMS returns `503 FLEET_UNAVAILABLE`; assignment rechecks each vehicle and returns
`409 VEHICLE_UNAVAILABLE` when it cannot be used. Never substitute demo trucks.

Seeds preserve existing work and edited crew profiles. The people manifests are
exact copies from shared auth; BMS creates crew profiles only, never accounts.
Booking's customer tracking capability uses a separate required secret. Inbound
webhooks retain their signature checks and original raw request bytes.

## Verification

From this root, run `npm ci`, `npm run bootstrap:ci`, `npm run audit:ci`,
`npm run typecheck`, `npm run lint:ci`, `npm run build` and `npm test` to cover
all five subprocesses. Alternatively run `npm ci`, `npm run build` and
`npm run test:auth` inside the booking,
dispatch and completion folders. Gateway uses `npm test` for its full
verifier/session/proxy suite. Booking also has webhook/tracking tests
(`npx jest --runInBand`). Dispatch has the existing workflow suite (`npm test`)
and VMMS consumer tests (`npx jest --runInBand`). The projection supports
`npm run once` inside its configured container.

From this folder, `npm run test:live` checks live BMS routes and suite crew links
using local seed accounts. Tokens stay in memory and test sessions are signed
out. From the workspace, run `node scripts/check-system.mjs bms --static-only`.
The lead owns the full suite checker, fleet parity and final sign-off.

## Hosting and default seeders

Each process has a `Dockerfile.prod` with a production runner and full-source
`seed` target. The owning database migration command is `npx prisma migrate deploy`.
Set `DB_POOL_MAX=2` for every database process. See the complete
[hosting handoff](../docs/context/bms/hosting-handoff.md) for process settings,
timers, images, staging jobs and provider-key delivery.

After migrations, per-owner `npm run seed` commands install only missing
catalogs/linked crew and preserve existing edits. From this root, `npm run seed`
orchestrates the full 150-booking demo through all owners and projection.
The running stack, actual VMMS fleet API and shared directory are required;
it never fabricates trucks or auth accounts. Reruns resume the frozen dataset
and preserve modified or deleted scenarios. All seed entrypoints reject
production without the job-only `SEED_ALLOW=staging` override.

`npm run test:seed:integration` checks isolated real BMS databases/services with
controlled upstream contracts. It requires the hosting-check runner/seed images
and BMS database containers; it never resets the application's databases.
