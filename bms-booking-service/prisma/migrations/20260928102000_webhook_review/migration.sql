ALTER TABLE "welinc_webhook_events"
  ADD COLUMN "reviewed_at" TIMESTAMPTZ,
  ADD COLUMN "reviewed_by" UUID,
  ADD COLUMN "review_resolution" VARCHAR(30),
  ADD COLUMN "review_note" VARCHAR(500);

CREATE INDEX "welinc_webhook_events_result_reviewed_at_idx"
  ON "welinc_webhook_events"("result", "reviewed_at");
