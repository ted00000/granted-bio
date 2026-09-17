-- NIH RePORTER audit: capture underused API fields on projects.
--
-- The RePORTER v2 API publishes structured fields we've been ingesting
-- as delimited strings, scratch keys, or not at all. Audit adds seven
-- source-truth columns extracted from the API response we already
-- fetch on every sync.
--
-- Fields (with example values from a real 2025 NCI project):
--
--   contact_pi_name   — 'AARONS, GREGORY' — the load-bearing PI, distinct
--                       from multi-PIs. Currently mashed into pi_names
--                       delimited string; this makes it filterable.
--
--   admin_ic          — 'NCI' — Institute/Center abbreviation from
--                       agency_ic_admin.abbreviation. Was previously
--                       derived into a scratch key and dropped.
--
--   foa_number        — 'RFA-CA-21-056' — Funding Opportunity Announcement
--                       number from opportunity_number. Clusters grants
--                       issued under the same call, useful for competitor
--                       triage.
--
--   direct_cost_amt   — DECIMAL(12,2) — direct cost from
--                       direct_cost_amt. total_cost is direct + indirect;
--                       breakout enables real cost analysis.
--
--   indirect_cost_amt — DECIMAL(12,2) — indirect cost from
--                       indirect_cost_amt.
--
--   study_section     — 'AIDS Malignancy Study Section' — review group
--                       name from full_study_section.name.
--
--   spending_categories — TEXT[] — NIH's own topic classification
--                       (parsed from spending_categories_desc). Example
--                       tags: 'Cancer', 'Cervical Cancer', 'HIV/AIDS'.
--
-- Existing partial data: `program_officer` is already extracted but had
-- a gap window (2026-01-31 → 2026-08-05 API syncs left it NULL). The
-- ETL update from this ship keeps the existing extraction and closes
-- the gap on future syncs. Rows synced during the gap will fill from
-- the historical RePORTER refresh (Phase 5, ~55h overnight job).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS contact_pi_name TEXT,
  ADD COLUMN IF NOT EXISTS admin_ic VARCHAR(20),
  ADD COLUMN IF NOT EXISTS foa_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS direct_cost_amt DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS indirect_cost_amt DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS study_section VARCHAR(300),
  ADD COLUMN IF NOT EXISTS spending_categories TEXT[];

CREATE INDEX IF NOT EXISTS idx_projects_admin_ic
  ON projects(admin_ic) WHERE admin_ic IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_foa_number
  ON projects(foa_number) WHERE foa_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_study_section
  ON projects(study_section) WHERE study_section IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_spending_categories_gin
  ON projects USING GIN (spending_categories);

CREATE INDEX IF NOT EXISTS idx_projects_contact_pi_trgm
  ON projects USING GIN (contact_pi_name gin_trgm_ops)
  WHERE contact_pi_name IS NOT NULL;

COMMENT ON COLUMN projects.contact_pi_name IS
  'Load-bearing PI on the grant from RePORTER contact_pi_name. Distinct from projects.pi_names (which is a delimited concatenation of contact + multi-PIs). Trigram-indexed for name search.';
COMMENT ON COLUMN projects.admin_ic IS
  'NIH Institute/Center abbreviation from agency_ic_admin.abbreviation (NCI, NIAID, NIMH, NINDS, etc.). The IC that administers the grant.';
COMMENT ON COLUMN projects.foa_number IS
  'Funding Opportunity Announcement number from opportunity_number. Grants issued under the same FOA share this value — enables competitor triage on the same call.';
COMMENT ON COLUMN projects.direct_cost_amt IS
  'Direct cost from direct_cost_amt. total_cost = direct_cost_amt + indirect_cost_amt.';
COMMENT ON COLUMN projects.indirect_cost_amt IS
  'Indirect (F&A) cost from indirect_cost_amt.';
COMMENT ON COLUMN projects.study_section IS
  'NIH review group / study section name from full_study_section.name. The review body that scored the grant.';
COMMENT ON COLUMN projects.spending_categories IS
  'NIH RCDC topic tags from spending_categories_desc, split on ";". Broad NIH-emitted topic classification alongside our internal primary_category.';
