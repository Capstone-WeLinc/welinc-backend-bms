CREATE TABLE "internal_booking_commands" (
    "command_id" UUID NOT NULL,
    "booking_uuid" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_booking_commands_pkey" PRIMARY KEY ("command_id")
);
CREATE INDEX "internal_booking_commands_booking_uuid_created_at_idx" ON "internal_booking_commands"("booking_uuid", "created_at");
ALTER TABLE "bookings" ADD COLUMN "assignment_reference" UUID;
