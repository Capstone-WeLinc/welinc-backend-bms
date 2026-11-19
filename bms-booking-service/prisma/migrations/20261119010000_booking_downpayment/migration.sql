-- Amount the client paid before the trip; Post-Service and Daily Sales deduct it from the balance.
ALTER TABLE "bookings" ADD COLUMN "downpayment" DECIMAL(10,2);
