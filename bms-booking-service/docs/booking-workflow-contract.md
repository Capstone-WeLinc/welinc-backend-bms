# Proposed Booking, Dispatch, and Completion contract

Status: **proposal for BMS owners to approve; no live service calls use this contract yet.** The Welinc customer booking webhook remains inbound to Booking only. This document concerns internal BMS workflows and does not require changes to the Welinc, auth, or Analytics systems.

## Current coupling found in the BMS backend

| Flow | Current atomic writes | Extraction consequence |
|---|---|---|
| `SchedulingService.assign` | `ScheduledBooking`, `JobOrder`, and `Booking.status = Assigned` in one PostgreSQL transaction. It also checks BMS `Vehicle.status` and may create a `Driver` from sample data before that transaction. | Dispatch cannot simply call Booking after writing its own database. A reservation and compensation process is needed, using the fleet owner's approved contract. Sample driver creation must end before cutover. |
| `PostServiceService.upsert` | `PostService`, `JobOrder.paymentStatus`, `DailySales`, Booking payment fields, and Booking completion status. | Completion must own work evidence, payment/settlement, and sales separately. The existing code treats completion as `Paid` and can create a sale without verified payment; finance must define the replacement rule. |
| Welinc webhook | Booking row, external ID mapping, and event ledger together. | These stay in Booking's one database and one transaction. The public sender URL changes upstream routing only after reconciliation. |

## Proposed command shape

Every internal command carries an authenticated BMS service identity, a globally unique `commandId` for retry deduplication, canonical booking UUID, and `expectedVersion`. Booking returns the new version, canonical status, and an explicit `applied`/`duplicate` result. A reused `commandId` with different content is a conflict. A stale version is a conflict; callers must read the latest booking before retrying. Browser roles and the Welinc HMAC secret are not internal service credentials. The auth owner must approve the service identity mechanism.

| Proposed command | Caller | Booking precondition | Booking change | Caller follow-up |
|---|---|---|---|---|
| `ConfirmAssignment` | Dispatch | Draft or rescheduled, not cancelled/completed; expected version matches; reservation reference present | `Assigned`, operational hold, version increment | Mark assignment/job order confirmed. On rejection or timeout, inspect command status and release or retry the reservation safely. |
| `ReleaseAssignment` | Dispatch | Assignment reference matches current booking; no completed work | Clear operational hold and return to an approved planning status, version increment | Release the fleet reservation; keep a record of compensation. |
| `ConfirmWorkCompletion` | Completion | Assigned booking and work evidence; expected version matches | `Completed`, operational hold retained, version increment | Record completion evidence and sales eligibility. **No automatic `Paid` status.** |
| `RecordPaymentHold` | Completion | Approved payment/settlement evidence; expected version matches | Payment hold projection only, version increment | Completion remains the canonical writer of payment facts. Booking does not store or infer settlement amount. |

These names and transitions are design proposals, not implemented API endpoints. In particular, the allowed path for `Scheduled`, issue reporting, rescheduling after dispatch, and payment corrections needs owner approval.

## Failure and cancellation rules to settle before coding

- Dispatch holds a reservation only for a bounded period. A pending command is retried by `commandId`; a timeout is not proof of rejection. Confirm Booking's result before releasing or announcing assignment.
- A Welinc edit or cancellation that conflicts with an operational/payment hold is stored as a blocked event for operator review. Do not acknowledge a cancelled booking to downstream BMS staff while its reservation remains active.
- Completion can mark work complete without marking it paid. A payment correction or refund must be handled by Completion and projected to Booking only if Booking needs a hold flag.
- The three existing identifiers retain distinct meanings: UUID `id` is the cross-service key; `bookingId` and `bookingNo` are preserved unique aliases for old routes, job orders, and customer display.
- Before live implementation, define the exact service credential, idempotency retention period, status matrix, reservation lease, timeout/retry bounds, compensation owner, and audit trail. Add contract tests for duplicate, stale, concurrent, and partially completed commands.
