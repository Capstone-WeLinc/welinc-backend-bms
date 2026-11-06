ALTER TABLE "dispatch_job_orders" ADD COLUMN "needs_update" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "approval_event_receipts" (
  "event_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_event_receipts_pkey" PRIMARY KEY ("event_id")
);
