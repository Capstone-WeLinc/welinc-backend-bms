CREATE TABLE "vehicle_availability_sample_vehicles" (
    "id" UUID NOT NULL,
    "plate_number" VARCHAR(20) NOT NULL,
    "alias" VARCHAR(120) NOT NULL,
    "truck_type_id" VARCHAR(80) NOT NULL,
    "brand" VARCHAR(80),
    "model" VARCHAR(100),
    "capacity_kg" INTEGER,
    "dimensions" VARCHAR(120) NOT NULL,
    "required_helpers_min" INTEGER NOT NULL,
    "required_helpers_max" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "status_reason" TEXT,
    "status_since" VARCHAR(40),
    "expected_back_at" VARCHAR(40),
    "status_remarks" TEXT,
    "crew" JSONB NOT NULL,
    "current_assignment" JSONB,
    "upcoming_schedule" JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT "vehicle_availability_sample_vehicles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicle_availability_sample_vehicles_plate_number_key"
    ON "vehicle_availability_sample_vehicles"("plate_number");

-- Display-only sample fleet restored after removing it from the availability view.
-- It is deliberately separate from assignable vehicles and excludes ABC-1234,
-- DEF-9012, and XYZ-5678, which are real seed records the user asked to remove.
INSERT INTO "vehicle_availability_sample_vehicles"
    ("id", "plate_number", "alias", "truck_type_id", "brand", "model", "capacity_kg", "dimensions",
     "required_helpers_min", "required_helpers_max", "status", "status_reason", "status_since",
     "expected_back_at", "status_remarks", "crew", "current_assignment", "upcoming_schedule")
VALUES
('b1f00000-0000-4000-8000-000000000001', 'NBD-2041', 'Unit 1', '6W 14ft. with Lifter', NULL, NULL, 3000,
 '14 x 7 x 6 FT.', 1, 2, 'assigned', NULL, NULL, NULL, NULL,
 '[{"id":"sample-driver-1","name":"Juan Dela Cruz","role":"Driver"},{"id":"sample-helper-1","name":"Pedro Santos","role":"Helper"},{"id":"sample-helper-2","name":"Jose Ramos","role":"Helper"}]',
 '{"bookingNumber":"SAMPLE-BK-0001","jobOrderNumber":"SAMPLE-JO-0001","service":"Corporate Delivery","date":"2026-11-05","startTime":"08:00 AM","endTime":"02:00 PM","route":"NC — NCR to NCR. Pickup: NCR · Delivery: NCR"}',
 '[{"date":"2026-11-07","time":"08:00 AM","bookingNumber":"SAMPLE-BK-0002","locationCode":"N1"}]'),
('b1f00000-0000-4000-8000-000000000002', 'NCF-7716', 'Unit 2', '10ft. Closed Van', NULL, NULL, 1500,
 '10 x 6 x 6 FT.', 2, 2, 'assigned', NULL, NULL, NULL, NULL,
 '[{"id":"sample-driver-2","name":"Mark Reyes","role":"Driver"},{"id":"sample-helper-3","name":"Leo Garcia","role":"Helper"},{"id":"sample-helper-4","name":"Allan Torres","role":"Helper"}]',
 '{"bookingNumber":"SAMPLE-BK-0003","jobOrderNumber":"SAMPLE-JO-0003","service":"Unit to Unit Transfer","date":"2026-11-06","startTime":"09:00 AM","endTime":"03:00 PM","route":"NC — NCR to NCR. Pickup: NCR · Delivery: NCR"}', '[]'),
('b1f00000-0000-4000-8000-000000000003', 'NDA-3398', 'Unit 3', '4W L300 FB Van', 'Mitsubishi', 'L300', NULL,
 '4W - 7''5" x 4 x 4 FT.', 1, 2, 'available', NULL, NULL, NULL, NULL, '[]', NULL, '[]'),
('b1f00000-0000-4000-8000-000000000004', 'NEG-5560', 'Unit 4', '6W 14ft. with Lifter', NULL, NULL, 3000,
 '14 x 7 x 6 FT.', 2, 2, 'available', NULL, NULL, NULL, NULL, '[]', NULL, '[]'),
('b1f00000-0000-4000-8000-000000000005', 'NFK-8824', 'Unit 5', '10ft. Closed Van', NULL, NULL, 1500,
 '10 x 6 x 6 FT.', 2, 2, 'under_maintenance', 'Scheduled preventive maintenance', '2026-11-01', '2026-11-08',
 'Temporary sample maintenance record', '[]', NULL, '[]'),
('b1f00000-0000-4000-8000-000000000006', 'NGH-1207', 'Unit 6', '4W L300 FB Van', 'Mitsubishi', 'L300', NULL,
 '4W - 7''5" x 4 x 4 FT.', 1, 1, 'under_repair', 'Engine overhaul', '2026-10-28', '2026-11-12',
 'Temporary sample repair record', '[]', NULL, '[]'),
('b1f00000-0000-4000-8000-000000000007', 'NHJ-6643', 'Unit 7', '4W L300 FB Van', 'Mitsubishi', 'L300', NULL,
 '4W - 7''5" x 4 x 4 FT.', 1, 1, 'assigned', NULL, NULL, NULL, NULL,
 '[{"id":"sample-driver-3","name":"Ramon Cruz","role":"Driver"},{"id":"sample-helper-5","name":"Eric Bautista","role":"Helper"}]',
 '{"bookingNumber":"SAMPLE-BK-0004","jobOrderNumber":"SAMPLE-JO-0004","service":"Lipat Bahay","date":"2026-11-09","startTime":"10:00 AM","endTime":"04:00 PM","route":"N1 — NCR to Bulacan. Pickup: NCR · Delivery: Bulacan"}', '[]'),
('b1f00000-0000-4000-8000-000000000008', 'NJL-9035', 'Unit 8', '6W 14ft. with Lifter', NULL, NULL, 3000,
 '14 x 7 x 6 FT.', 2, 2, 'under_maintenance', 'Preventive inspection', '2026-11-02', '2026-11-06',
 'Temporary sample maintenance record', '[]', NULL, '[]');
