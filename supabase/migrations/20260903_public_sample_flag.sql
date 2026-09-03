-- Public sample flag for user_reports.
--
-- Before this: /sample/[slug] pages rendered the report's
-- markdown_content as a single scrollable document — the old
-- pre-portal design. Meanwhile /reports/[id] (owner view) and
-- /share/[token] (recipient view) both render the full portal
-- (sidebar + dashboard + per-section pages). Sample visitors were
-- seeing something meaningfully worse than what a buyer gets.
--
-- The fix flips the model: sample pages become permanent redirects
-- to /reports/[id], and getReport() allows anon access when the
-- row is flagged as a public sample. Portal UI is reused verbatim
-- — no maintenance drift between what samples show and what buyers
-- get.
--
-- Security note: this column is the ONLY thing that grants anon
-- access to a user_reports row. Every other read path enforces
-- ownership via RLS + auth checks. Only admins should ever set
-- this flag; it's not user-facing.

ALTER TABLE user_reports
  ADD COLUMN IF NOT EXISTS is_public_sample BOOLEAN NOT NULL DEFAULT FALSE;

-- Cheap lookup for the public-sample check in getReport().
-- Partial index because 99.99% of rows will be false.
CREATE INDEX IF NOT EXISTS idx_user_reports_public_sample
  ON user_reports (id)
  WHERE is_public_sample = TRUE;

-- Backfill: mark the two hardcoded sample IDs as public. These
-- match the SAMPLE_REPORT_ID constants in the /sample/*/page.tsx
-- files that ship as permanent redirects to /reports/[id].
UPDATE user_reports
   SET is_public_sample = TRUE
 WHERE id IN (
   '0555ef1d-3cdc-4d97-b8da-a114d2721550', -- Liquid Biopsy For Early Cancer Detection Research
   '2ef956ba-8aa8-45a2-81b7-50010fe353e1'  -- Radioligand Cancer Therapy Investment
 );

COMMENT ON COLUMN user_reports.is_public_sample IS
  'When TRUE, the report is anon-accessible via /reports/[id] regardless of user_id. Set only by admins for marketing sample reports; getReport() honors this flag to skip auth.';
