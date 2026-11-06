-- Temporary SS rates transcribed from the supplied reference screenshot.
INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('f4b239ec-bb44-45ba-c4ba-000000000001', '6W 14ft. with Lifter', 'SS', 'SS: 6W 14FT. Truck w/ lifter', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 5990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('f4b239ec-bb44-45ba-c4ba-000000000002', '6W 14ft. with Lifter', 'SS', 'SS: 6W 14FT w/ lifter (2 HELPERS)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 6980, '/images/truck-rates/nc-6w-14ft.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "truck_rates"
  WHERE "truck_type_id" = '6W 14ft. with Lifter' AND "location_code" = 'SS' AND "is_active" = TRUE;
  IF row_count <> 2 THEN
    RAISE EXCEPTION 'Temporary SS seed expected 2 active 6W rates, got %', row_count;
  END IF;
END $$;
