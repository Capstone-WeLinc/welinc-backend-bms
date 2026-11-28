-- Spec bms/0022: post-service forms sent by drivers from the mobile app.
-- AlterTable
ALTER TABLE "work_outcomes"
    ADD COLUMN "submitted_by" UUID,
    ADD COLUMN "submitted_at" TIMESTAMPTZ(6),
    ADD COLUMN "reported_payment_method" VARCHAR(20),
    ADD COLUMN "reported_add_on_payment" VARCHAR(20),
    ADD COLUMN "last_edited_by" UUID;
