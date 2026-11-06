INSERT INTO helpers (id, emp_id, name, initials, crew_status, updated_at) VALUES
(gen_random_uuid(), 'HLP-001', 'Jose Ramos', 'JR', 'Available', now()),
(gen_random_uuid(), 'HLP-002', 'Pedro Garcia', 'PG', 'Available', now()),
(gen_random_uuid(), 'HLP-003', 'Miguel Torres', 'MT', 'Available', now())
ON CONFLICT (emp_id) DO NOTHING;
SELECT setval('dispatch_helper_emp_no_seq', GREATEST(3, (SELECT COALESCE(MAX(NULLIF(regexp_replace(emp_id, '[^0-9]', '', 'g'), '')::bigint), 3) FROM helpers)));
