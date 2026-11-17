-- Retain linked, edited or historically assigned crew. Only exact legacy fixtures qualify.
DELETE FROM helpers h
WHERE h.user_id IS NULL AND h.is_active = true AND h.crew_status = 'Available'
AND h.contact IS NULL AND h.email IS NULL AND h.join_date IS NULL
AND h.emergency_name IS NULL AND h.emergency_contact IS NULL AND h.total_trips = 0
AND h.created_at = h.updated_at
AND (h.emp_id,h.name,h.initials) IN (('HLP-001','Jose Ramos','JR'),('HLP-002','Pedro Garcia','PG'),('HLP-003','Miguel Torres','MT'))
AND NOT EXISTS (SELECT 1 FROM dispatch_assignments a WHERE h.id::text = ANY(a.helper_ids))
AND NOT EXISTS (SELECT 1 FROM dispatch_job_orders j WHERE j.team ILIKE '%' || h.name || '%');
