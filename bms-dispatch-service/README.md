# BMS Dispatch service

NestJS service on 3022, with its owned PostgreSQL database on host port 5435.
It owns assignments, drivers, helpers, vehicle dispatch profiles and job orders.
Browser routes enter through `/bms/scheduling`, `/bms/dispatch`, `/bms/job-order`
and `/bms/config` at the suite gateway. Shared BMS tokens, session confirmation
and existing role restrictions protect operations.

VMMS owns vehicles and garages. Dispatch calls its fleet API with a BMS service
assertion and a `fleet.read` token for VMMS. Lists cache for 30 seconds;
assignment fetches the vehicle fresh. Fleet outages fail with
`503 FLEET_UNAVAILABLE`; unavailable/deleted vehicles fail assignment with
`409 VEHICLE_UNAVAILABLE`. BMS keeps dispatch-only metadata locally and never
reads another group's database. Driver/helper identities link to the suite
manifest, temporary roles are excluded from pick lists, and daily directory
checks anonymize erased linked identities.

The existing pending/confirmed/releasing assignment workflow, Booking holds,
retry endpoints and unique active vehicle slot guard remain. Distributed or
completed work still requires operator review. Payment and work outcomes
belong to Completion.

Start with the workspace BMS Compose file after the shared stack. Configuration
comes from the backend root environment. `npm test` checks existing fleet and
assignment behavior; `npx jest --runInBand` checks auth and the VMMS consumer.
The repeatable seed links 12 drivers and 20 helpers without replacing edited
profiles. See [backend setup](../README.md) and the
[BMS checklist](../../docs/context/bms/integration-checklist.md).
