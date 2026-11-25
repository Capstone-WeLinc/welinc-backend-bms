-- Spec bms/0013: what each additional service includes, how it can be paid, and what it excludes.
-- Shown with View details on Services Offered and in the New Booking wizard; Admin can edit them.
ALTER TABLE service_offerings
  ADD COLUMN inclusions TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN payment_options TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN exclusions TEXT[] NOT NULL DEFAULT '{}',
  -- Added once per service when the booking is paid in cash; separate from the booking's
  -- cash-on-delivery surcharge.
  ADD COLUMN cash_charge DECIMAL(10,2) NOT NULL DEFAULT 0;

-- The details from the client's service sheet, for the services that already exist.
-- Only empty details are filled, so nothing Admin entered is overwritten.
UPDATE service_offerings SET inclusions = ARRAY['2 staff members', '1 cling wrap', '1 packaging tape', 'Used cartons', '6 hours of packing service']::text[],
  payment_options = ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Basic Packing Service' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['4 staff members', '1 cling wrap', '1 packaging tape', 'Used cartons', '6 hours of packing service']::text[],
  payment_options = ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Standard Packing Service' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['4 staff members', '1 cling wrap', '1 packaging tape', '10 boxes', '1 roll of bubble wrap', 'Used cartons', '6 hours of packing service']::text[],
  payment_options = ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Premium Packing Service' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['1 motorized staff member', '2 hours of ocular/site inspection']::text[],
  payment_options = ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Ocular / Site Inspection (NCR)' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['1 motorized staff member', '2 hours of ocular/site inspection']::text[],
  payment_options = ARRAY['Cash', 'GCash', 'Credit/debit card', 'Bank transfer']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Ocular / Site Inspection (Outside NCR)' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['1 staff member', '1 cling wrap', '1 packaging tape', '1 bubble wrap', '6 boxes', 'Up to 6 hours of packing service']::text[],
  payment_options = ARRAY['Cash (with an additional PHP 500 charge)', 'GCash (no additional charge)', 'Bank transfer (no additional charge)']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Custom Packing Service' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['1 motorized staff member', 'Fuel', 'Up to 6 hours of service', 'An additional PHP 100 per succeeding hour']::text[],
  payment_options = ARRAY['Cash upon delivery', 'GCash', 'Bank transfer']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Motorized Helper' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';
UPDATE service_offerings SET inclusions = ARRAY['1 motorized staff member', 'Fuel', 'Up to 6 hours of service', 'An additional PHP 100 per succeeding hour']::text[],
  payment_options = ARRAY['Cash upon delivery', 'GCash', 'Bank transfer']::text[],
  exclusions = ARRAY['Condominium and subdivision entry and exit fees']::text[]
WHERE name = 'Motorized Helper Premium' AND inclusions = '{}' AND payment_options = '{}' AND exclusions = '{}';

-- The services whose sheet says "Cash (with an additional PHP 500 charge)". Only a charge still at
-- its default is set, like the details above.
UPDATE service_offerings SET cash_charge = 500
WHERE name IN ('Basic Packing Service', 'Standard Packing Service', 'Premium Packing Service', 'Custom Packing Service', 'Ocular / Site Inspection (NCR)') AND cash_charge = 0;
