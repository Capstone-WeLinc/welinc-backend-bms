CREATE TABLE "service_offerings" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "duration" VARCHAR(50),
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_services_catalog" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "booking_services_catalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "protective_materials_catalog" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "protective_materials_catalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_offerings_name_key" ON "service_offerings"("name");
CREATE INDEX "service_offerings_is_active_idx" ON "service_offerings"("is_active");
CREATE UNIQUE INDEX "booking_services_catalog_name_key" ON "booking_services_catalog"("name");
CREATE INDEX "booking_services_catalog_is_active_idx" ON "booking_services_catalog"("is_active");
CREATE UNIQUE INDEX "protective_materials_catalog_name_key" ON "protective_materials_catalog"("name");
CREATE INDEX "protective_materials_catalog_is_active_idx" ON "protective_materials_catalog"("is_active");
