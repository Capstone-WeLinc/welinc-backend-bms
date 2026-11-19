# BMS Booking service

NestJS service on 3021, with its owned PostgreSQL database on host port 5434.
Browser routes enter through the suite gateway under `/bms/booking`,
`/bms/approvals` and `/bms/config`. Shared auth's BMS tokens and session checks
protect office operations; existing BMS role restrictions still apply.

Booking owns booking records, service/material catalogs, approval work and
versioned operational/payment holds. Approval names are resolved through
shared auth's directory API. It does not query an auth database.

Signed integration webhooks preserve raw bytes and signature/idempotency
checks. Public customer tracking uses a dedicated required tracking secret.
Optional mail, webhook and mapping settings are documented in the backend
root `.env.example`; secret values must stay private.

Start with the workspace BMS Compose file after the shared stack. Configuration
comes from the backend root environment. Use `npm run build` and
`npx jest --runInBand` here. See [backend setup](../README.md) and the
[BMS checklist](../../docs/context/bms/integration-checklist.md).
