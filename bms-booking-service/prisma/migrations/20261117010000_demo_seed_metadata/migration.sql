CREATE TABLE bms_demo_seed_runs (
 dataset_key VARCHAR(60) PRIMARY KEY,
 manifest JSONB NOT NULL,
 phase VARCHAR(30) NOT NULL DEFAULT 'planned',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
