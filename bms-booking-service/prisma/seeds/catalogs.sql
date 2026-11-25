-- Insert missing defaults only; edited catalog rows win. No DDL belongs in a seed.
INSERT INTO service_offerings (id, name, description, duration, price, inclusions, payment_options, exclusions, cash_charge, updated_at) VALUES
(gen_random_uuid(), 'Basic Packing Service', 'Basic packing assistance for moving preparation.', '6hr', 3450, ARRAY['2 staff members', '1 cling wrap', '1 packaging tape', 'Used cartons', '6 hours of packing service']::text[], ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 500, now()),
(gen_random_uuid(), 'Standard Packing Service', 'Standard-level packing assistance with additional manpower.', '6hr', 5950, ARRAY['4 staff members', '1 cling wrap', '1 packaging tape', 'Used cartons', '6 hours of packing service']::text[], ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 500, now()),
(gen_random_uuid(), 'Premium Packing Service', 'Premium packing service with additional packaging materials.', '6hr', 7950, ARRAY['4 staff members', '1 cling wrap', '1 packaging tape', '10 boxes', '1 roll of bubble wrap', 'Used cartons', '6 hours of packing service']::text[], ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 500, now()),
(gen_random_uuid(), 'Ocular / Site Inspection (NCR)', 'On-site inspection service within NCR.', '2hr', 300, ARRAY['1 motorized staff member', '2 hours of ocular/site inspection']::text[], ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 500, now()),
(gen_random_uuid(), 'Ocular / Site Inspection (Outside NCR)', 'Provincial or outside NCR ocular/site inspection.', '2hr', 600, ARRAY['1 motorized staff member', '2 hours of ocular/site inspection']::text[], ARRAY['Cash', 'GCash', 'Credit/debit card', 'Bank transfer']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 0, now()),
(gen_random_uuid(), 'Custom Packing Service', 'Customizable packing service with limited packaging materials.', '6hr', 2720, ARRAY['1 staff member', '1 cling wrap', '1 packaging tape', '1 bubble wrap', '6 boxes', 'Up to 6 hours of packing service']::text[], ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 500, now()),
(gen_random_uuid(), 'Motorized Helper', 'Motorized helper assistance for small moving tasks.', '6hr', 990, ARRAY['1 motorized staff member', 'Fuel', 'Up to 6 hours of service', 'An additional PHP 100 per succeeding hour']::text[], ARRAY['Cash upon delivery', 'GCash', 'Bank transfer']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 0, now()),
(gen_random_uuid(), 'Motorized Helper Premium', 'Premium motorized helper assistance.', '6hr', 1490, ARRAY['1 motorized staff member', 'Fuel', 'Up to 6 hours of service', 'An additional PHP 100 per succeeding hour']::text[], ARRAY['Cash upon delivery', 'GCash', 'Bank transfer']::text[], ARRAY['Condominium and subdivision entry and exit fees']::text[], 0, now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO protective_materials_catalog (id, name, price, updated_at) VALUES
(gen_random_uuid(), '20x20x20 Box', 130, now()),
(gen_random_uuid(), 'Bubble Wrap', 1000, now()),
(gen_random_uuid(), 'Cling Wrap', 400, now()),
(gen_random_uuid(), 'Half Bubble Wrap', 500, now()),
(gen_random_uuid(), 'Packaging Tape', 50, now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO booking_services_catalog (id, name, description, updated_at) VALUES
(gen_random_uuid(), 'Lipat Bahay', 'Residential moving service', now()),
(gen_random_uuid(), 'Office Pull Out', 'Commercial and office relocation', now()),
(gen_random_uuid(), 'Corporate Delivery', 'Business logistics delivery', now()),
(gen_random_uuid(), 'Unit to Unit Transfer', 'Move between unit or condo floors', now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('5a1d9b42-11aa-4b10-8a10-000000000001', '6W 14ft. with Lifter', 'NC', 'NC: 6W 14 FT. W/ Lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 6990, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000002', '6W 14ft. with Lifter', 'NC', 'NC: 6W 14 FT. W/ Lifter (2 Helpers) (PM)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helpers, Insurance as per T&C', 6291, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000003', '10ft. Closed Van', 'NC', 'NC: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 6490, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000004', '10ft. Closed Van', 'NC', 'NC: 10FT. Closed Van (2 Helpers) (PM)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 5841, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000005', '4W L300 FB Van', 'NC', 'NC: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 3990, NULL, TRUE),
('5a1d9b42-11aa-4b10-8a10-000000000006', '4W L300 FB Van', 'NC', 'NC: 4W L300 FB Van (PM)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 3591, NULL, TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('6b2ea053-22bb-4c21-9b21-000000000001', '6W 14ft. with Lifter', 'N1', 'N1: 6W 14FT. Truck w/ Lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('6b2ea053-22bb-4c21-9b21-000000000002', '10ft. Closed Van', 'N1', 'N1: 10FT Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper/s, Insurance as per T&C', 7990, '/images/truck-rates/n1-10ft-closed-van.jpg', TRUE),
('6b2ea053-22bb-4c21-9b21-000000000003', '4W L300 FB Van', 'N1', 'N1: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 4990, '/images/truck-rates/n1-4w-l300.jpg', TRUE),
('6b2ea053-22bb-4c21-9b21-000000000004', '4W L300 FB Van', 'N1', 'N1: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6480, '/images/truck-rates/n1-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('7c3fb164-33cc-4d32-ac32-000000000001', '6W 14ft. with Lifter', 'N2', 'N2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8990, '/images/truck-rates/n2-6w-14ft.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000002', '10ft. Closed Van', 'N2', 'N2: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper/s, Insurance as per T&C', 8490, '/images/truck-rates/n2-10ft-closed-van.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000003', '4W L300 FB Van', 'N2', 'N2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/n2-4w-l300.jpg', TRUE),
('7c3fb164-33cc-4d32-ac32-000000000004', '4W L300 FB Van', 'N2', 'N2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 7480, '/images/truck-rates/n2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('8d4ac275-44dd-4e43-bd43-000000000001', '6W 14ft. with Lifter', 'S1', 'S1: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/s1-6w-14ft.jpg', TRUE),
('8d4ac275-44dd-4e43-bd43-000000000002', '10ft. Closed Van', 'S1', 'S1: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7990, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('8d4ac275-44dd-4e43-bd43-000000000003', '4W L300 FB Van', 'S1', 'S1: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 4990, '/images/truck-rates/s1-4w-l300.jpg', TRUE),
('8d4ac275-44dd-4e43-bd43-000000000004', '4W L300 FB Van', 'S1', 'S1: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6480, '/images/truck-rates/s1-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('9e5bd386-55ee-4f54-ce54-000000000001', '6W 14ft. with Lifter', 'S2', 'S2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8990, '/images/truck-rates/s2-6w-14ft.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000002', '10ft. Closed Van', 'S2', 'S2: 10FT. Closed Van (2 Helpers)', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/s2-10ft-closed-van.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000003', '10ft. Closed Van', 'S2', 'S2 (WD): 10FT. Truck with 2 Helpers', '10 x 6 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 7990, '/images/truck-rates/s2-wd-10ft-truck.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000004', '4W L300 FB Van', 'S2', 'S2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('9e5bd386-55ee-4f54-ce54-000000000005', '4W L300 FB Van', 'S2', 'S2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 7480, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('af6ce497-66ff-4065-df65-000000000001', '6W 14ft. with Lifter', 'L1', 'L1: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('af6ce497-66ff-4065-df65-000000000002', '10ft. Closed Van', 'L1', 'L1: 6W 10 ft. Closed Van (2 Helpers)', '6W - 10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7990, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('af6ce497-66ff-4065-df65-000000000003', '4W L300 FB Van', 'L1', 'L1: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 4990, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('af6ce497-66ff-4065-df65-000000000004', '4W L300 FB Van', 'L1', 'L1: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6480, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('b07df5a8-7700-4176-e076-000000000001', '6W 14ft. with Lifter', 'L2', 'L2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('b07df5a8-7700-4176-e076-000000000002', '10ft. Closed Van', 'L2', 'L2: 6W 10 ft. Closed Van (2 Helpers)', '6W - 10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 8490, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('b07df5a8-7700-4176-e076-000000000003', '4W L300 FB Van', 'L2', 'L2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('b07df5a8-7700-4176-e076-000000000004', '4W L300 FB Van', 'L2', 'L2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 7480, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('c18e06b9-8811-4287-f187-000000000001', '6W 14ft. with Lifter', 'R1', 'R1: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7490, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('c18e06b9-8811-4287-f187-000000000002', '10ft. Closed Van', 'R1', 'R1: 6W 10 ft. Closed Van (2 Helpers)', '6W - 10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 6990, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('c18e06b9-8811-4287-f187-000000000003', '4W L300 FB Van', 'R1', 'R1: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 4790, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('c18e06b9-8811-4287-f187-000000000004', '4W L300 FB Van', 'R1', 'R1: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6280, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('d29017ca-9922-4398-a298-000000000001', '6W 14ft. with Lifter', 'R2', 'R2: 6W 14FT. Truck w/ lifter (2 Helpers)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000002', '10ft. Closed Van', 'R2', 'R2: 6W 10 ft. Closed Van (2 Helpers)', '6W - 10 x 6 x 6 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helpers, Insurance as per T&C', 7490, '/images/truck-rates/s1-10ft-closed-van.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000003', '4W L300 FB Van', 'R2', 'R2: 4W L300 FB Van', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 5290, '/images/truck-rates/s2-4w-l300.jpg', TRUE),
('d29017ca-9922-4398-a298-000000000004', '4W L300 FB Van', 'R2', 'R2: 4W L300 FB Van (2 HELPERS)', '4W - 7''5" x 4 x 4 FT. (L x H x W)', 'Gas, Toll fee, Driver, Helper, Insurance as per T&C', 6780, '/images/truck-rates/s2-4w-l300-2-helpers.jpg', TRUE),
('e3a128db-aa33-44a9-b3a9-000000000001', '6W 14ft. with Lifter', 'NN', 'NN: 14FT. Truck w/ Lifter (1 HELPER)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 5990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('e3a128db-aa33-44a9-b3a9-000000000002', '6W 14ft. with Lifter', 'NN', 'NN: 14FT. Truck w/ Lifter (2 HELPERS)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helpers, Insurance as per T&C', 6980, '/images/truck-rates/n1-6w-14ft.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;

INSERT INTO "truck_rates" ("id", "truck_type_id", "location_code", "name", "dimensions", "inclusions", "rate_6hr", "image_url", "is_active") VALUES
('f4b239ec-bb44-45ba-c4ba-000000000001', '6W 14ft. with Lifter', 'SS', 'SS: 6W 14FT. Truck w/ lifter', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper/s, Insurance as per T&C', 5990, '/images/truck-rates/n1-6w-14ft.jpg', TRUE),
('f4b239ec-bb44-45ba-c4ba-000000000002', '6W 14ft. with Lifter', 'SS', 'SS: 6W 14FT w/ lifter (2 HELPERS)', '6W - 14 x 7 x 6 FT. (L x H x W)', 'Gas, Driver, Helper, Insurance as per T&C', 6980, '/images/truck-rates/nc-6w-14ft.jpg', TRUE)
ON CONFLICT ("truck_type_id", "location_code", "name") DO NOTHING;
