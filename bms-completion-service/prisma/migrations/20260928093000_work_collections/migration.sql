CREATE TABLE "work_outcomes" (
  "booking_uuid" UUID NOT NULL, "booking_id_alias" VARCHAR(50) NOT NULL, "booking_no" VARCHAR(50) NOT NULL,
  "client" VARCHAR(200) NOT NULL, "service" VARCHAR(100) NOT NULL, "service_date" TEXT NOT NULL,
  "amount_due" DECIMAL(10,2), "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "post_service_status" VARCHAR(50) NOT NULL DEFAULT 'Pending Review', "arrival_time" VARCHAR(20),
  "additional_materials" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "issue_reported" BOOLEAN NOT NULL DEFAULT false,
  "issue_details" TEXT, "completion_notes" TEXT, "finalized_by" UUID, "finalized_at" TIMESTAMPTZ(6),
  "confirm_command_id" UUID, "booking_version" INTEGER, "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "work_outcomes_pkey" PRIMARY KEY ("booking_uuid")
);
CREATE UNIQUE INDEX "work_outcomes_booking_id_alias_key" ON "work_outcomes"("booking_id_alias");

CREATE TABLE "collections" (
  "id" UUID NOT NULL, "idempotency_key" UUID NOT NULL, "booking_uuid" UUID NOT NULL,
  "booking_id_alias" VARCHAR(50) NOT NULL, "booking_no" VARCHAR(50) NOT NULL,
  "client_name" VARCHAR(200) NOT NULL, "amount" DECIMAL(10,2) NOT NULL,
  "method" VARCHAR(20) NOT NULL, "reference" VARCHAR(100) NOT NULL,
  "collected_at" TIMESTAMPTZ(6) NOT NULL, "business_date" VARCHAR(10) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING', "recorded_by" UUID NOT NULL,
  "verified_by" UUID, "verified_at" TIMESTAMPTZ(6), "rejected_by" UUID, "rejected_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collections_idempotency_key_key" ON "collections"("idempotency_key");
CREATE INDEX "collections_business_date_status_idx" ON "collections"("business_date", "status");
CREATE INDEX "collections_booking_uuid_idx" ON "collections"("booking_uuid");

CREATE TABLE "refunds" (
  "id" UUID NOT NULL, "collection_id" UUID NOT NULL, "amount" DECIMAL(10,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "refunded_at" TIMESTAMPTZ(6) NOT NULL,
  "business_date" VARCHAR(10) NOT NULL, "approved_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "refunds_collection_id_idx" ON "refunds"("collection_id");
CREATE INDEX "refunds_business_date_idx" ON "refunds"("business_date");

CREATE TABLE "daily_submissions" (
  "date" VARCHAR(10) NOT NULL, "submitted_at" TIMESTAMPTZ(6) NOT NULL,
  "submitted_by" UUID NOT NULL,
  CONSTRAINT "daily_submissions_pkey" PRIMARY KEY ("date")
);
