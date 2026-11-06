# BMS Dispatch service

This native NestJS API owns assignments, local BMS helpers, and job orders in PostgreSQL on host port `5435`. It listens on `3003` when started by the root launcher. Public `/scheduling`, `/job-order`, and `/bms/config/{vehicles,drivers,helpers,garages}` calls arrive through the gateway.

Assignment creates a pending record, checks the local fleet and conflicting holds, confirms Booking's operational hold using a versioned idempotent command, then confirms its own record and creates a job order. A confirmed assignment can be changed before distribution: Dispatch persists a release command, releases Booking's hold, then confirms the replacement. Admin may explicitly release un-distributed work for Welinc conflict review at `POST /dispatch/assignments/:bookingUuid/release`. Distributed or completed work requires operator review. Pending assignments and releases are visible at `GET /dispatch/assignments`; Operations or Admin can call `POST /dispatch/assignments/:bookingUuid/retry`. A recovered release leaves the booking ready for a new assignment. Distribution belongs to Dispatch. Payment and work outcomes belong to Completion.

The local fleet adapter reads the vehicle, driver and garage tables in the shared WeLinc database and writes the driver fields required by the BMS editor there. BMS helpers live in Dispatch's own database. `BMS_PARTNER_DATABASE_URL` accepts loopback hosts only.

Start the whole stack using the root launcher. For manual startup copy `.env.example` to `.env`, configure Booking URL, the local Auth JWT secret, shared internal service key, and local partner database URL, then run `npm ci`, `npx prisma migrate deploy`, and `npm run start:dev`. Verify with `npm run typecheck` and `npm run build`.
