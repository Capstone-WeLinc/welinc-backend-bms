CREATE TABLE "audit_events" (
  "id" UUID NOT NULL, "actor_id" UUID NOT NULL, "role" VARCHAR(40),
  "action" VARCHAR(100) NOT NULL, "path" VARCHAR(500) NOT NULL,
  "ip_address" VARCHAR(45), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");
