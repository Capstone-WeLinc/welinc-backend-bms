-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "booking_id" VARCHAR(50) NOT NULL,
    "booking_no" VARCHAR(50) NOT NULL,
    "client" VARCHAR(200) NOT NULL,
    "full_name" VARCHAR(200),
    "service" VARCHAR(100) NOT NULL,
    "service_type" VARCHAR(120),
    "delivery_category" VARCHAR(40),
    "date" TEXT NOT NULL,
    "preferred_time" VARCHAR(100),
    "pickup_address" TEXT,
    "delivery_address" TEXT,
    "pickup_landmark" TEXT,
    "delivery_landmark" TEXT,
    "address" TEXT,
    "contact" VARCHAR(100),
    "email" VARCHAR(255),
    "delivery_location" TEXT,
    "estimated_items" INTEGER,
    "item_details" TEXT,
    "special_instructions" TEXT,
    "notes" TEXT,
    "services_availed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "protective_materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "additional_services_availed" JSONB,
    "has_insurance" BOOLEAN NOT NULL DEFAULT false,
    "permit_required" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(40) NOT NULL DEFAULT 'For Plotting',
    "version" INTEGER NOT NULL DEFAULT 1,
    "operational_hold" BOOLEAN NOT NULL DEFAULT false,
    "payment_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "welinc_booking_links" (
    "external_booking_id" VARCHAR(100) NOT NULL,
    "booking_uuid" UUID NOT NULL,
    "last_occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "welinc_booking_links_pkey" PRIMARY KEY ("external_booking_id")
);

-- CreateTable
CREATE TABLE "welinc_webhook_events" (
    "event_id" VARCHAR(128) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "external_booking_id" VARCHAR(100) NOT NULL,
    "payload_sha256" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(100),

    CONSTRAINT "welinc_webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_id_key" ON "bookings"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_no_key" ON "bookings"("booking_no");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "welinc_booking_links_booking_uuid_key" ON "welinc_booking_links"("booking_uuid");

-- CreateIndex
CREATE INDEX "welinc_webhook_events_external_booking_id_occurred_at_idx" ON "welinc_webhook_events"("external_booking_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "welinc_booking_links" ADD CONSTRAINT "welinc_booking_links_booking_uuid_fkey" FOREIGN KEY ("booking_uuid") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE SEQUENCE booking_no_seq START WITH 1 INCREMENT BY 1;
