UPDATE "truck_rates"
SET "image_url" = CASE
  WHEN "truck_type_id" = '6W 14ft. with Lifter' THEN '/images/truck-rates/nc-6w-14ft.jpg'
  WHEN "truck_type_id" = '10ft. Closed Van' AND "name" NOT LIKE '%(PM)%' THEN '/images/truck-rates/nc-10ft-closed-van.jpg'
  WHEN "truck_type_id" = '10ft. Closed Van' AND "name" LIKE '%(PM)%' THEN '/images/truck-rates/nc-10ft-closed-van-pm.jpg'
  WHEN "truck_type_id" = '4W L300 FB Van' THEN '/images/truck-rates/nc-4w-l300.jpg'
END
WHERE "location_code" = 'NC'
  AND "truck_type_id" IN ('6W 14ft. with Lifter', '10ft. Closed Van', '4W L300 FB Van');
