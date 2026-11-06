-- Temporary S2 rate rows transcribed from the supplied reference screenshot.
INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('9e5bd386-55ee-4f54-ce54-000000000001', '6W 14ft. with Lifter', 'S2', 'S2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8990, '/images/truck-rates/s2-6w-14ft.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000002', '10ft. Closed Van', 'S2', 'S2: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/s2-10ft-closed-van.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000003', '10ft. Closed Van', 'S2', 'S2 (WD): 10FT. Truck with 2 Helpers', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 7990, '/images/truck-rates/s2-wd-10ft-truck.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000004', '4W L300 FB Van', 'S2', 'S2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000005', '4W L300 FB Van', 'S2', 'S2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 7480, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '6W 14ft. with Lifter' AND "location_code" = 'S2' AND "is_active" = TRUE;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'Temporary S2 seed expected 1 active 6W rate, got %', row_count;
  END IF;

  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '10ft. Closed Van' AND "location_code" = 'S2' AND "is_active" = TRUE;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'Temporary S2 seed expected 2 active 10ft rates, got %', row_count;
  END IF;

  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '4W L300 FB Van' AND "location_code" = 'S2' AND "is_active" = TRUE;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'Temporary S2 seed expected 2 active 4W rates, got %', row_count;
  END IF;
END $$;
