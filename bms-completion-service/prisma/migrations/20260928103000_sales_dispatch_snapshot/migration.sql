ALTER TABLE "collections"
  ADD COLUMN "garage" VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
  ADD COLUMN "delivery_type" VARCHAR(20) NOT NULL DEFAULT 'Inhouse',
  ADD COLUMN "plate_number" VARCHAR(20) NOT NULL DEFAULT 'N/A',
  ADD COLUMN "assigned_team" VARCHAR(100) NOT NULL DEFAULT 'Unassigned';
