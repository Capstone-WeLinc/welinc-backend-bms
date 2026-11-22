-- Spec bms/0005: drivers and helpers now file their own leave and emergency requests.
-- Every request filed so far came from Operations on the crew member's behalf (the only way
-- to file under spec 0003), so all of them are removed together with their history.
-- The tables stay; crew self-service requests use them.
DELETE FROM "crew_leave_events";
DELETE FROM "crew_leave_requests";
