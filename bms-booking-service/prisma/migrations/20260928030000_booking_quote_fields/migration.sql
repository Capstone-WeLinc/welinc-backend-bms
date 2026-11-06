ALTER TABLE "bookings"
  ADD COLUMN "amount" DECIMAL(10,2),
  ADD COLUMN "total_amount" TEXT,
  ADD COLUMN "requested_payment_method" VARCHAR(100);
