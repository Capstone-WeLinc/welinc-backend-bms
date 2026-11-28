-- Spec bms/0023: the team a reschedule released, until the booking is assigned again.
-- AlterTable
ALTER TABLE "dispatch_assignments"
    ADD COLUMN "released_driver_id" UUID,
    ADD COLUMN "released_helper_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
