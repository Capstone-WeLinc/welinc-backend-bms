ALTER TABLE "dispatch_assignments"
  ADD COLUMN "service_date" TEXT,
  ADD COLUMN "confirm_command_id" UUID,
  ADD COLUMN "booking_version" INTEGER,
  ADD COLUMN "last_error" TEXT;
UPDATE "dispatch_assignments" SET "service_date" = '' WHERE "service_date" IS NULL;
ALTER TABLE "dispatch_assignments" ALTER COLUMN "service_date" SET NOT NULL;
CREATE UNIQUE INDEX "dispatch_active_vehicle_slot_key" ON "dispatch_assignments"("vehicle_id", "service_date", "dispatch_time")
  WHERE "vehicle_id" IS NOT NULL AND "state" IN ('PENDING', 'CONFIRMED');
CREATE UNIQUE INDEX "dispatch_active_driver_slot_key" ON "dispatch_assignments"("driver_id", "service_date", "dispatch_time")
  WHERE "driver_id" IS NOT NULL AND "state" IN ('PENDING', 'CONFIRMED');
CREATE SEQUENCE dispatch_job_order_no_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE dispatch_helper_emp_no_seq START WITH 1 INCREMENT BY 1;
CREATE TABLE "helpers" (
  "id" UUID NOT NULL,
  "emp_id" VARCHAR(40) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "initials" VARCHAR(10),
  "contact" VARCHAR(80),
  "crew_status" VARCHAR(40) NOT NULL DEFAULT 'Available',
  "total_trips" INTEGER NOT NULL DEFAULT 0,
  "join_date" DATE,
  "emergency_name" VARCHAR(160),
  "emergency_contact" VARCHAR(80),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "helpers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "helpers_emp_id_key" ON "helpers"("emp_id");
