ALTER TABLE "bookings"
  ADD COLUMN "discrepancy_note" TEXT,
  ADD COLUMN "flagged" BOOLEAN NOT NULL DEFAULT false;
