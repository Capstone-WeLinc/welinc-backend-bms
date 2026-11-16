# BMS Completion and Sales service

NestJS service on 3023, with its owned PostgreSQL database on host port 5436.
Browser `/bms/post-service`, `/bms/collections` and `/bms/daily-sales` requests
arrive through the suite and BMS gateways. Shared auth's BMS tokens, session
confirmation and existing BMS role restrictions protect operations.

Completion owns work outcomes, recorded and verified collections, linked
refunds and daily sales submissions. Work completion does not create payment.
Customer Support or Admin records collections; Admin verifies or rejects them.
Only verified amounts, including partial payments and linked refund reversals,
enter daily sales. Booking receives versioned internal payment-hold commands.
Existing pending/retry endpoints and payment concurrency controls remain.

Start with the workspace BMS Compose file after the shared stack. Configuration
comes from the backend root environment; no auth database is queried. Use
`npm run build` and `npm run test:auth` here. See [backend setup](../README.md)
and the [BMS checklist](../../docs/context/bms/integration-checklist.md).
