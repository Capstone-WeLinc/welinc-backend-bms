CREATE TABLE bms_demo_seed_records (
 dataset_key VARCHAR(60) NOT NULL,
 table_name VARCHAR(60) NOT NULL,
 record_id VARCHAR(80) NOT NULL,
 booking_uuid UUID NOT NULL,
 row_hash CHAR(64) NOT NULL,
 PRIMARY KEY(table_name,record_id)
);
CREATE INDEX bms_demo_seed_records_dataset_idx ON bms_demo_seed_records(dataset_key,booking_uuid);
