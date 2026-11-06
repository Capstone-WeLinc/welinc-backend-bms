ALTER TABLE "collections" ADD COLUMN "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "collections" ADD COLUMN "decision_reason" VARCHAR(500);
UPDATE "collections" SET "submitted_at" = "created_at";

CREATE TABLE "refund_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "collection_id" UUID NOT NULL,
  "booking_uuid" UUID NOT NULL,
  "booking_no" VARCHAR(50) NOT NULL,
  "client_name" VARCHAR(200) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'Requested',
  "requested_by" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" UUID,
  "decided_at" TIMESTAMPTZ(6),
  "decision_reason" VARCHAR(500),
  "refund_id" UUID,
  CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_requests_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "refund_requests_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refund_requests_refund_id_key" ON "refund_requests"("refund_id");
CREATE INDEX "refund_requests_status_requested_at_idx" ON "refund_requests"("status", "requested_at");
CREATE INDEX "refund_requests_requested_by_requested_at_idx" ON "refund_requests"("requested_by", "requested_at");
CREATE UNIQUE INDEX "refund_requests_one_pending_per_collection" ON "refund_requests"("collection_id") WHERE "status" = 'Requested';

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

CREATE TABLE "approval_event_receipts" (
  "event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_event_receipts_pkey" PRIMARY KEY ("event_id")
);
