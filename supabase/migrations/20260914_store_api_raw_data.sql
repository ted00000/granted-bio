-- Store raw API responses on every enrichment target.
--
-- Why: the CT.gov path already stores its raw response
-- (clinical_studies.api_raw_data). Every future column addition on
-- clinical_studies is a one-hour job because we can extract from
-- stored raw without re-hitting the API. The projects, patents, and
-- publications tables don't do this — which is why we currently have
-- one-off backfill scripts like backfill_program_officers_api.py:
-- because we didn't extract the program officer originally, and now
-- we have to re-hit the RePORTER API to fill 200K+ rows just for one
-- field.
--
-- Load-bearing rule going forward: every ETL path that fetches from
-- an external API stores the full response as JSONB on the target
-- row. Extraction may be partial today; raw data preserves optionality
-- for tomorrow.
--
-- Storage is cheap; API calls are the constrained resource.
--
-- No backfill possible for rows that already exist — we didn't save
-- the raw at the time. New/updated rows populate api_raw_data going
-- forward. Over time the coverage grows as records naturally refresh.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS api_raw_data JSONB;

ALTER TABLE patents
  ADD COLUMN IF NOT EXISTS api_raw_data JSONB;

ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS api_raw_data JSONB;

COMMENT ON COLUMN projects.api_raw_data IS
  'Full NIH RePORTER API v2 project response as returned by the ETL. Populated by etl/sync_projects_via_api.py and etl/fetch_fy2026.py at fetch time. NULL for rows loaded before 2026-09-14 or via legacy CSV path.';

COMMENT ON COLUMN patents.api_raw_data IS
  'Full USPTO ODP responses as returned by the lazy hydrator: {search, meta_data, assignment}. Populated by src/lib/patents/hydrator.ts on first patent detail view. NULL until hydrated.';

COMMENT ON COLUMN publications.api_raw_data IS
  'Full PubMed esummary record as returned by the ETL. Populated by etl/fetch_pubmed_metadata.py at fetch time. NULL for rows loaded before 2026-09-14.';
