ALTER TABLE helpers ADD COLUMN user_id UUID UNIQUE;
CREATE SEQUENCE IF NOT EXISTS dispatch_driver_emp_no_seq START 13;
CREATE TABLE drivers (
id UUID PRIMARY KEY, user_id UUID UNIQUE, emp_id VARCHAR(40) NOT NULL UNIQUE,
name VARCHAR(100) NOT NULL, initials VARCHAR(10), crew_status VARCHAR(40) NOT NULL DEFAULT 'Available',
license_number VARCHAR(50) NOT NULL, license_type VARCHAR(50) NOT NULL DEFAULT 'Professional', license_expiry DATE,
contact VARCHAR(80), email VARCHAR(160), address TEXT, emergency_name VARCHAR(160), emergency_contact VARCHAR(80), join_date DATE,
total_trips INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, deleted_at TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE vehicle_dispatch_profiles (
vehicle_id UUID PRIMARY KEY, required_helpers INT NOT NULL DEFAULT 0, truck_type_id VARCHAR(80),
status_reason TEXT, status_since TIMESTAMPTZ, expected_back_at TIMESTAMPTZ, status_remarks TEXT,
driver_id UUID REFERENCES drivers(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
