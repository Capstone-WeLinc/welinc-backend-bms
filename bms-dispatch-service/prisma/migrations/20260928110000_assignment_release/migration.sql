ALTER TABLE "dispatch_assignments" ADD COLUMN "release_command_id" UUID;
ALTER TABLE "dispatch_assignments" ADD COLUMN "release_booking_version" INTEGER;
DROP INDEX "dispatch_active_vehicle_slot_key";
DROP INDEX "dispatch_active_driver_slot_key";
CREATE UNIQUE INDEX "dispatch_active_vehicle_slot_key" ON "dispatch_assignments"("vehicle_id", "service_date", "dispatch_time")
  WHERE "vehicle_id" IS NOT NULL AND "state" IN ('PENDING', 'CONFIRMED', 'RELEASING');
CREATE UNIQUE INDEX "dispatch_active_driver_slot_key" ON "dispatch_assignments"("driver_id", "service_date", "dispatch_time")
  WHERE "driver_id" IS NOT NULL AND "state" IN ('PENDING', 'CONFIRMED', 'RELEASING');
