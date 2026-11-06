ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "selected_truck" JSONB;

CREATE TABLE IF NOT EXISTS "truck_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "truck_type_id" VARCHAR(120) NOT NULL,
  "location_code" VARCHAR(10) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "dimensions" VARCHAR(200) NOT NULL,
  "inclusions" VARCHAR(500) NOT NULL,
  "rate_6hr" DECIMAL(10,2) NOT NULL,
  "image_url" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "truck_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "truck_rates_truck_type_id_location_code_name_key" UNIQUE ("truck_type_id", "location_code", "name")
);

CREATE INDEX IF NOT EXISTS "truck_rates_truck_type_id_location_code_is_active_idx"
  ON "truck_rates"("truck_type_id", "location_code", "is_active");

-- TEMPORARY NC seed from the fallback values supplied in the feature request.
-- Replace with the approved complete rate card when available. PM meaning needs confirmation.
INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('5a1d9b42-11aa-4b10-8a10-000000000001', '6W 14ft. with Lifter', 'NC', 'NC: 6W 14 FT. W/ Lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 6990, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000002', '6W 14ft. with Lifter', 'NC', 'NC: 6W 14 FT. W/ Lifter (2 Helpers) (PM)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helpers, Insurance as per T&C', 6291, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000003', '10ft. Closed Van', 'NC', 'NC: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 6490, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000004', '10ft. Closed Van', 'NC', 'NC: 10FT. Closed Van (2 Helpers) (PM)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 5841, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000005', '4W L300 FB Van', 'NC', 'NC: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 3990, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000006', '4W L300 FB Van', 'NC', 'NC: 4W L300 FB Van (PM)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 3591, NULL, TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

DO $$
DECLARE
  expected_type TEXT;
  actual_count INTEGER;
BEGIN
  FOREACH expected_type IN ARRAY ARRAY['6W 14ft. with Lifter', '10ft. Closed Van', '4W L300 FB Van'] LOOP
    SELECT COUNT(*) INTO actual_count
    FROM "truck_rates"
    WHERE "truck_type_id" = expected_type AND "location_code" = 'NC' AND "is_active" = TRUE;
    IF actual_count <> 2 THEN
      RAISE EXCEPTION 'Temporary NC seed expected 2 active rates for %, got %', expected_type, actual_count;
    END IF;
  END LOOP;
END $$;
