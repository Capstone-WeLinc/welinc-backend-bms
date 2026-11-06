-- Temporary N2 rate rows transcribed from the supplied reference screenshots.
INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('7c3fb164-33cc-4d32-ac32-000000000001', '6W 14ft. with Lifter', 'N2', 'N2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8990, '/images/truck-rates/n2-6w-14ft.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000002', '10ft. Closed Van', 'N2', 'N2: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper/s, Insurance as per T&C', 8490, '/images/truck-rates/n2-10ft-closed-van.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000003', '4W L300 FB Van', 'N2', 'N2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/n2-4w-l300.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000004', '4W L300 FB Van', 'N2', 'N2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 7480, '/images/truck-rates/n2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '6W 14ft. with Lifter' AND "location_code" = 'N2' AND "is_active" = TRUE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'Temporary N2 seed expected 1 active 6W rate, got %', row_count;
  END IF;

  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '10ft. Closed Van' AND "location_code" = 'N2' AND "is_active" = TRUE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'Temporary N2 seed expected 1 active 10ft rate, got %', row_count;
  END IF;

  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '4W L300 FB Van' AND "location_code" = 'N2' AND "is_active" = TRUE;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'Temporary N2 seed expected 2 active 4W rates, got %', row_count;
  END IF;
END $$;
