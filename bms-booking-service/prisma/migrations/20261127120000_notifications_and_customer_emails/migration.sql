-- Spec bms/0021: notifications are written by the backend when something happens, with read state
-- kept per person (it used to be guessed in each browser and kept in localStorage). Customer emails
-- are queued here and sent with retries instead of once, inline.
-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "recipient_role" VARCHAR(40),
    "recipient_user_id" UUID,
    "actor_id" UUID,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "href" VARCHAR(300),
    "booking_uuid" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("notification_id","user_id")
);

-- CreateTable
CREATE TABLE "customer_emails" (
    "id" UUID NOT NULL,
    "booking_uuid" UUID,
    "booking_no" VARCHAR(50) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_role_created_at_idx" ON "notifications"("recipient_role", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "notification_reads_user_id_idx" ON "notification_reads"("user_id");

-- CreateIndex
CREATE INDEX "customer_emails_status_next_attempt_at_idx" ON "customer_emails"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_uuid_fkey" FOREIGN KEY ("booking_uuid") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every notification is for a role or a person (or both).
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_check"
  CHECK ("recipient_role" IS NOT NULL OR "recipient_user_id" IS NOT NULL);
