-- Update patent counts on projects.
--
-- IMPORTANT: This script joins projects.project_number to patents.project_number
-- via a CORE form derived in SQL. The projects table stores project_number in
-- MIXED format — some rows in core form ("R01MH134973"), some in full form
-- ("5R01MH134973-02"). Patents (and other linkage tables) only store core form.
-- A naive equality join would silently undercount whenever a project is
-- stored in full form.
--
-- Use etl/fix_linked_counts.py for the canonical maintenance path — that
-- script handles aggregation across all fiscal-year variants. This SQL is
-- kept as a fallback / one-shot reset that can be run in the Supabase SQL
-- editor when Python tooling isn't available.

WITH normalized_patent_counts AS (
  SELECT
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(trim(pat.project_number)), '^[0-9]', ''),
        '-\d+$', ''
      ),
      '-[A-Z]\d+$', ''
    ) AS core_pn,
    COUNT(DISTINCT pat.patent_id)::integer AS cnt
  FROM patents pat
  WHERE pat.project_number IS NOT NULL
  GROUP BY core_pn
)
UPDATE projects p
SET patent_count = sub.cnt
FROM normalized_patent_counts sub
WHERE regexp_replace(
        regexp_replace(
          regexp_replace(upper(trim(p.project_number)), '^[0-9]', ''),
          '-\d+$', ''
        ),
        '-[A-Z]\d+$', ''
      ) = sub.core_pn
  AND (p.patent_count IS NULL OR p.patent_count != sub.cnt);
