-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "legacy_booking_completions" (
    "booking_uuid" UUID NOT NULL,
    "booking_id_alias" VARCHAR(50) NOT NULL,
    "booking_no" VARCHAR(50) NOT NULL,
    "legacy_booking_status" VARCHAR(40) NOT NULL,
    "legacy_post_service_status" VARCHAR(40),
    "legacy_payment_status" VARCHAR(50),
    "legacy_payment_method" TEXT,
    "amount" DECIMAL(10,2),
    "amount_paid" DECIMAL(10,2),
    "arrival_status" VARCHAR(40),
    "delay_minutes" INTEGER,
    "overtime_hours" DECIMAL(4,2),
    "overtime_charge" DECIMAL(10,2),
    "arrival_time" VARCHAR(20),
    "additional_materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completion_notes" TEXT,
    "issue_reported" BOOLEAN,
    "issue_details" TEXT,
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by" VARCHAR(100),
    "source_created_at" TIMESTAMPTZ(6) NOT NULL,
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legacy_booking_completions_pkey" PRIMARY KEY ("booking_uuid")
);

-- CreateTable
CREATE TABLE "legacy_post_services" (
    "id" UUID NOT NULL,
    "booking_uuid" UUID NOT NULL,
    "post_service_status" VARCHAR(50) NOT NULL,
    "additional_materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "legacy_payment_status" VARCHAR(50),
    "legacy_payment_method" VARCHAR(100),
    "amount_paid" DECIMAL(10,2),
    "arrival_time" VARCHAR(20),
    "issue_reported" BOOLEAN NOT NULL,
    "issue_details" TEXT,
    "completion_notes" TEXT,
    "finalized_at" TIMESTAMPTZ(6),
    "finalized_by" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legacy_post_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_daily_sales" (
    "id" UUID NOT NULL,
    "booking_uuid" UUID,
    "booking_id_alias" VARCHAR(50),
    "booking_link_state" VARCHAR(16) NOT NULL,
    "date" TEXT NOT NULL,
    "garage" VARCHAR(120) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "plate_number" VARCHAR(20) NOT NULL,
    "assigned_team" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_remarks" TEXT,
    "cash_payment" DECIMAL(10,2) NOT NULL,
    "bdo_payment" DECIMAL(10,2) NOT NULL,
    "gcash_payment" DECIMAL(10,2) NOT NULL,
    "xendit_payment" DECIMAL(10,2) NOT NULL,
    "total_daily_sales" DECIMAL(10,2) NOT NULL,
    "date_of_payment" TEXT NOT NULL,
    "trace_no" VARCHAR(100) NOT NULL,
    "client_name" VARCHAR(200) NOT NULL,
    "checked_by" VARCHAR(100),
    "noted_by" VARCHAR(100),
    "approved_by" VARCHAR(100),
    "legacy_status" VARCHAR(20) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_evidence_state" VARCHAR(16) NOT NULL DEFAULT 'UNVERIFIED',

    CONSTRAINT "legacy_daily_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legacy_booking_completions_booking_id_alias_key" ON "legacy_booking_completions"("booking_id_alias");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_post_services_booking_uuid_key" ON "legacy_post_services"("booking_uuid");

-- CreateIndex
CREATE INDEX "legacy_daily_sales_date_idx" ON "legacy_daily_sales"("date");

-- CreateIndex
CREATE INDEX "legacy_daily_sales_booking_uuid_idx" ON "legacy_daily_sales"("booking_uuid");
