BEGIN;

-- Nullable additions preserve legacy records without inventing personal data.
ALTER TABLE employees
  ADD COLUMN cnic varchar(15),
  ADD COLUMN location varchar(160),
  ADD CONSTRAINT employees_cnic_format CHECK (cnic IS NULL OR cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$'),
  ADD CONSTRAINT employees_location_format CHECK (location IS NULL OR (length(btrim(location)) BETWEEN 1 AND 160 AND location !~ '[[:cntrl:]]'));
CREATE UNIQUE INDEX employees_cnic_key ON employees(cnic);

-- Employment type belongs to an employment episode, including future rehires.
ALTER TABLE employment_episodes
  ADD COLUMN "employmentType" varchar(24),
  ADD CONSTRAINT employment_episodes_type_check CHECK ("employmentType" IS NULL OR "employmentType" IN ('FULL_TIME','PART_TIME','CONTRACT','INTERNSHIP','TEMPORARY'));

COMMIT;
