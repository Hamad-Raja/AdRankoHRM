BEGIN;
-- Keep the existing 1000-character API limit and retain every character.
-- Manager reviews prefix the reason with "ACCEPTED: " or "CONCERNS: ".
-- Rehire status/access evidence also includes a short system-owned prefix.
-- Widen only these storage fields; do not rewrite historical evidence.
ALTER TABLE employment_cases ALTER COLUMN "managerNote" TYPE varchar(1010);
ALTER TABLE employment_access_controls ALTER COLUMN reason TYPE varchar(1100);
ALTER TABLE employment_status_events ALTER COLUMN reason TYPE varchar(1100);
COMMIT;
