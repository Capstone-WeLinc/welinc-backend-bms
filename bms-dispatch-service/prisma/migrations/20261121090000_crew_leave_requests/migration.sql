-- Crew leave and emergency requests (spec bms/0003).
CREATE TABLE "crew_leave_requests" (
    "id" UUID NOT NULL,
    "crew_type" VARCHAR(10) NOT NULL,
    "crew_id" UUID NOT NULL,
    "crew_emp_id" VARCHAR(40) NOT NULL,
    "crew_name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "start_date" VARCHAR(10) NOT NULL,
    "end_date" VARCHAR(10) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'Requested',
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_reason" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "crew_leave_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crew_leave_requests_crew_type_check" CHECK ("crew_type" IN ('DRIVER', 'HELPER')),
    CONSTRAINT "crew_leave_requests_kind_check" CHECK ("kind" IN ('LEAVE', 'EMERGENCY')),
    CONSTRAINT "crew_leave_requests_status_check" CHECK ("status" IN ('Requested', 'Approved', 'Rejected', 'Withdrawn')),
    CONSTRAINT "crew_leave_requests_dates_check" CHECK ("start_date" <= "end_date")
);
CREATE INDEX "crew_leave_requests_crew_id_status_idx" ON "crew_leave_requests"("crew_id", "status");
CREATE INDEX "crew_leave_requests_status_idx" ON "crew_leave_requests"("status");
CREATE INDEX "crew_leave_requests_requested_by_idx" ON "crew_leave_requests"("requested_by");

CREATE TABLE "crew_leave_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crew_leave_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crew_leave_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "crew_leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "crew_leave_events_request_id_idx" ON "crew_leave_events"("request_id");
