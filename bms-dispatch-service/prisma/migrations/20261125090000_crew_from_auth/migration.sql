-- Spec bms/0012: drivers and helpers come from their account in Auth.
-- Name, email and contact number are read from Auth; BMS keeps only its own dispatch details.
-- The employee ID, initials and trip count are removed: no other system has them, and nothing kept the count up to date.

-- A row with no account cannot be listed or assigned any more. One with an account is listed while
-- the person holds the role in Auth, so the BMS-only "deleted" state goes away.
UPDATE drivers SET is_active = false WHERE user_id IS NULL;
UPDATE helpers SET is_active = false WHERE user_id IS NULL;
UPDATE drivers SET is_active = true, deleted_at = NULL WHERE user_id IS NOT NULL;
UPDATE helpers SET is_active = true WHERE user_id IS NOT NULL;

ALTER TABLE drivers
  DROP COLUMN emp_id,
  DROP COLUMN name,
  DROP COLUMN initials,
  DROP COLUMN contact,
  DROP COLUMN email,
  DROP COLUMN total_trips,
  -- A driver who just got an account has no license on file until Admin adds it.
  ALTER COLUMN license_number DROP NOT NULL;

ALTER TABLE helpers
  DROP COLUMN emp_id,
  DROP COLUMN name,
  DROP COLUMN initials,
  DROP COLUMN contact,
  DROP COLUMN email,
  DROP COLUMN total_trips;

ALTER TABLE crew_leave_requests DROP COLUMN crew_emp_id;

DROP SEQUENCE IF EXISTS dispatch_driver_emp_no_seq;
DROP SEQUENCE IF EXISTS dispatch_helper_emp_no_seq;
