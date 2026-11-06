CREATE TABLE "booking_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "booking_uuid" UUID NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "payload_before" JSONB,
  "payload_after" JSONB NOT NULL,
  "reason" VARCHAR(500),
  "status" VARCHAR(20) NOT NULL DEFAULT 'Pending',
  "requested_by" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "decision_reason" VARCHAR(500),
  "booking_version" INTEGER NOT NULL,
  CONSTRAINT "booking_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_change_requests_booking_uuid_fkey" FOREIGN KEY ("booking_uuid") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "booking_change_requests_status_requested_at_idx" ON "booking_change_requests"("status", "requested_at");
CREATE INDEX "booking_change_requests_requested_by_requested_at_idx" ON "booking_change_requests"("requested_by", "requested_at");
CREATE UNIQUE INDEX "booking_change_requests_one_pending_per_booking" ON "booking_change_requests"("booking_uuid") WHERE "status" = 'Pending';

CREATE TABLE "approval_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_type" VARCHAR(20) NOT NULL,
  "item_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_audit_events_item_idx" ON "approval_audit_events"("item_type", "item_id", "created_at");
CREATE INDEX "approval_audit_events_actor_idx" ON "approval_audit_events"("actor_id", "created_at");

CREATE TABLE "approval_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_type" VARCHAR(40) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  CONSTRAINT "approval_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_outbox_pending_idx" ON "approval_outbox"("processed_at", "created_at");
