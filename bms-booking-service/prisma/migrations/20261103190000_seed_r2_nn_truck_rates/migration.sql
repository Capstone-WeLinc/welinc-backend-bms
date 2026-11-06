-- Temporary R2 and NN rates transcribed from the supplied reference screenshots.
INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('d29017ca-9922-4398-a298-000000000001', '6W 14ft. with Lifter', 'R2', 'R2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000002', '10ft. Closed Van', 'R2', 'R2: 6W 10 ft. Closed Van (2 Helpers)', '6W - 10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7490, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000003', '4W L300 FB Van', 'R2', 'R2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5290, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000004', '4W L300 FB Van', 'R2', 'R2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6780, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE),
('e3a128db-aa33-44a9-b3a9-000000000001', '6W 14ft. with Lifter', 'NN', 'NN: 14FT. Truck w/ Lifter (1 HELPER)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('e3a128db-aa33-44a9-b3a9-000000000002', '6W 14ft. with Lifter', 'NN', 'NN: 14FT. Truck w/ Lifter (2 HELPERS)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helpers, Insurance as per T&C', 6980, '/images/truck-rates/n1-6w-14ft.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "location_code" = 'R2' AND "is_active" = TRUE;
  IF row_count <> 4 THEN
    RAISE EXCEPTION 'Temporary R2 seed expected 4 active rates, got %', row_count;
  END IF;

  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "location_code" = 'NN' AND "is_active" = TRUE;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'Temporary NN seed expected 2 active rates, got %', row_count;
  END IF;
END $$;
