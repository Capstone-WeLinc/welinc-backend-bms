-- Spec bms/0017: BMS no longer keeps a join date for drivers or helpers.
-- The Edit driver / Edit helper modals, the Crew Management column and the details modals stopped
-- showing it, and the dispatch service stopped reading and writing it, in the same release.
--
-- Safe to run: deploy the new dispatch service first (it never selects join_date), then run
-- `prisma migrate deploy`. IF EXISTS makes a re-run harmless. Nothing else reads these columns
-- (checked: BMS services, analytics, mobile). The values are not kept: back up the database first
-- if the old join dates might be needed later.

ALTER TABLE drivers DROP COLUMN IF EXISTS join_date;
ALTER TABLE helpers DROP COLUMN IF EXISTS join_date;
