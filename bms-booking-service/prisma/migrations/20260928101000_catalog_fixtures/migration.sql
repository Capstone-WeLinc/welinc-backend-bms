-- Local demo catalogs now live with the Booking service, without relying on
-- the retired BMS tables in the compatibility backend.
INSERT INTO service_offerings (id, name, description, duration, price, updated_at) VALUES
(gen_random_uuid(), 'Basic Packing Service', 'Basic packing assistance for moving preparation.', '6hr', 3450, now()),
(gen_random_uuid(), 'Standard Packing Service', 'Standard-level packing assistance with additional manpower.', '6hr', 5950, now()),
(gen_random_uuid(), 'Premium Packing Service', 'Premium packing service with additional packaging materials.', '6hr', 7950, now()),
(gen_random_uuid(), 'Ocular / Site Inspection (NCR)', 'On-site inspection service within NCR.', '2hr', 300, now()),
(gen_random_uuid(), 'Ocular / Site Inspection (Outside NCR)', 'Provincial or outside NCR ocular/site inspection.', '2hr', 600, now()),
(gen_random_uuid(), 'Custom Packing Service', 'Customizable packing service with limited packaging materials.', '6hr', 2720, now()),
(gen_random_uuid(), 'Motorized Helper', 'Motorized helper assistance for small moving tasks.', '6hr', 990, now()),
(gen_random_uuid(), 'Motorized Helper Premium', 'Premium motorized helper assistance.', '6hr', 1490, now())
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
