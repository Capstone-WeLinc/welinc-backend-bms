# BMS backend

This directory contains five separate BMS processes. Start them with the repository root launcher described in [the developer guide](../README.md). Docker hosts the three BMS PostgreSQL databases; the APIs, gateway, and projection worker run with Node.js.

| Component | Owns |
|---|---|
| `bms-booking-service` | Booking records, catalogs, and the signed inbound Welinc booking webhook |
| `bms-dispatch-service` | Assignments, helpers, job orders, and the disposable local fleet adapter |
| `bms-completion-service` | Work outcomes, collections, refunds, and daily sales |
| `bms-gateway` | Browser and webhook routing, plus combined activity logs |
| `bms-analytics-projection` | Derived read models for the separate Analytics API |

The legacy `welinc-backend-bms` NestJS application was reviewed before this layout replaced it. Its `/booking` create/list/get/update behavior belongs to Booking; its `DELETE /booking/:id` is represented by a guarded cancellation rather than deleting operational history. Its `/scheduling` routes belong to Dispatch, and its `/bms/config` fleet lists belong to Dispatch's local adapter. Booking now also supports editing the permit requirement before operational or payment work locks a booking. Legacy `Scheduled` and caller-provided payment status do not override the current assignment and verified collection workflows.

Auth and standalone Analytics remain outside this directory and are owned by their respective groups. This directory has no standalone server, Prisma schema, or seed command. Do not run the legacy seed against the shared local database; it would delete Auth, fleet, and booking records.
