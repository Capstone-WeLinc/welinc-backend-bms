ALTER TABLE "collections"
  ADD COLUMN "payment_command_id" UUID,
  ADD COLUMN "payment_expected_version" INTEGER,
  ADD COLUMN "projection_error" TEXT;
ALTER TABLE "refunds"
  ADD COLUMN "payment_command_id" UUID,
  ADD COLUMN "payment_expected_version" INTEGER,
  ADD COLUMN "projection_state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "projection_error" TEXT;
