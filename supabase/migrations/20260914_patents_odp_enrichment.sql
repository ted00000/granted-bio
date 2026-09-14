-- Patent enrichment columns for USPTO ODP hydration.
--
-- Architecture: lazy-on-view hydration. When a user opens a patent
-- detail page and the row has NULL api_last_updated, the page fires
-- /api/patents/[patent_id]/hydrate which runs 3 sequential USPTO ODP
-- calls (search → meta-data → assignment) and writes to these columns.
-- Subsequent views read cached data instantly.
--
-- USPTO ODP rate limit is 60 req/min per key, so bulk backfill is
-- not feasible (~42 hours dedicated key time for 49K patents). Only
-- patents someone actually opens get hydrated.
--
-- Field shapes align with the ODP response schema from
-- protocolSection.applicationMetaData (verified 2026-09-14 against
-- Georgia Tech patent 12070567). Not enum-constrained — ODP can
-- extend value sets without breaking us.
--
-- Note: `filing_date`, `issue_date`, and `patent_type` already exist
-- on the patents table but were 0% populated as of the 2026-09-14
-- audit. The hydrator writes to them alongside the new columns.

ALTER TABLE patents
  ADD COLUMN IF NOT EXISTS application_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS patent_type_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS patent_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS examiner_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS art_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS uspc_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS assignees TEXT[],
  ADD COLUMN IF NOT EXISTS inventors TEXT[],
  ADD COLUMN IF NOT EXISTS cpc_codes TEXT[],
  ADD COLUMN IF NOT EXISTS current_assignees TEXT[],
  ADD COLUMN IF NOT EXISTS assignment_history JSONB,
  ADD COLUMN IF NOT EXISTS api_last_updated TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hydration_error TEXT,
  ADD COLUMN IF NOT EXISTS hydration_error_at TIMESTAMPTZ;

-- Partial index: fast lookup of unhydrated rows during ops / debugging.
CREATE INDEX IF NOT EXISTS idx_patents_unhydrated
  ON patents(patent_id)
  WHERE api_last_updated IS NULL;

-- Partial index: search on application_number when we have it (e.g.
-- future reverse-lookups from an application context).
CREATE INDEX IF NOT EXISTS idx_patents_application_number
  ON patents(application_number)
  WHERE application_number IS NOT NULL;

COMMENT ON COLUMN patents.application_number IS
  'USPTO application number (applicationNumberText), 8 digits. Obtained via ODP search-by-patent-number. Populated by hydrator.';
COMMENT ON COLUMN patents.assignees IS
  'Original applicantBag[].applicantNameText from ODP meta-data — the entity that filed the application, not necessarily the current owner. See current_assignees for post-transfer owner.';
COMMENT ON COLUMN patents.current_assignees IS
  'Latest assigneeBag[].assigneeNameText from the most-recent entry in the ODP assignment endpoint. Reflects post-transfer ownership when the patent has been assigned.';
COMMENT ON COLUMN patents.assignment_history IS
  'Compact JSONB array: [{conveyance, recorded_date, assignees}]. Full history from ODP /assignment. Sorted by recorded_date ascending.';
COMMENT ON COLUMN patents.hydration_error IS
  'Short error class from last failed hydration attempt (e.g. "not_found_in_odp", "rate_limited", "network"). NULL when hydration succeeded or has not been attempted.';
