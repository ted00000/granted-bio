-- Add the unique constraint to clinical_studies that should have been
-- there from the start.
--
-- A single NIH project can fund multiple trials, and a single trial can
-- be linked to multiple NIH projects (same NCT cited by both a parent and
-- subproject grant, etc.). So the natural key for this junction-shaped
-- table is the composite (nct_id, project_number), not nct_id alone.
--
-- Until 2026-06-17 the only constraint on the table was the PK on `id`.
-- That meant the ETL loader at etl/load_to_supabase.py:329 was calling
-- supabase.upsert(..., on_conflict='nct_id') against a column with no
-- unique constraint. Postgres ON CONFLICT requires a unique or exclusion
-- constraint on the target column, so the upsert statements should have
-- been failing — they were apparently being swallowed by the loader's
-- batch try/except.
--
-- We verified before adding this constraint that the live table has zero
-- (nct_id, project_number) duplicates today, so the constraint adds
-- cleanly without a dedup step.

ALTER TABLE public.clinical_studies
ADD CONSTRAINT clinical_studies_nct_project_unique
UNIQUE (nct_id, project_number);
