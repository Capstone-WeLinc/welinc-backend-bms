-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "dispatch_assignments" (
    "id" UUID NOT NULL,
    "booking_uuid" UUID NOT NULL,
    "dispatch_time" VARCHAR(20),
    "garage" VARCHAR(120),
    "delivery_type" VARCHAR(20),
    "vehicle_id" UUID,
    "driver_id" UUID,
    "helper_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" VARCHAR(32) NOT NULL DEFAULT 'LEGACY_IMPORTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dispatch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_job_orders" (
    "id" UUID NOT NULL,
    "job_order_no" VARCHAR(50) NOT NULL,
    "booking_uuid" UUID NOT NULL,
    "booking_id_alias" VARCHAR(50) NOT NULL,
    "client" VARCHAR(200) NOT NULL,
    "service_date" TEXT NOT NULL,
    "truck" VARCHAR(50),
    "team" VARCHAR(100),
    "total_amount" DECIMAL(10,2),
    "legacy_payment_status" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "state" VARCHAR(32) NOT NULL DEFAULT 'LEGACY_IMPORTED',
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dispatch_job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_assignments_booking_uuid_key" ON "dispatch_assignments"("booking_uuid");

-- CreateIndex
CREATE INDEX "dispatch_assignments_vehicle_id_idx" ON "dispatch_assignments"("vehicle_id");

-- CreateIndex
CREATE INDEX "dispatch_assignments_driver_id_idx" ON "dispatch_assignments"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_job_orders_job_order_no_key" ON "dispatch_job_orders"("job_order_no");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_job_orders_booking_uuid_key" ON "dispatch_job_orders"("booking_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_job_orders_booking_id_alias_key" ON "dispatch_job_orders"("booking_id_alias");

-- CreateIndex
CREATE INDEX "dispatch_job_orders_status_idx" ON "dispatch_job_orders"("status");
