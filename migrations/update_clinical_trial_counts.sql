-- Update clinical trial counts on projects.
--
-- IMPORTANT: This script joins projects.project_number to clinical_studies
-- via a CORE form derived in SQL. The projects table stores project_number in
-- MIXED format — some rows in core form, some in full form. Linkage tables
-- only store core. A naive equality join silently undercounts whenever a
-- project is stored in full form.
--
-- Use etl/fix_linked_counts.py for the canonical maintenance path.

WITH normalized_trial_counts AS (
  SELECT
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(trim(cs.project_number)), '^[0-9]', ''),
        '-\d+$', ''
      ),
      '-[A-Z]\d+$', ''
    ) AS core_pn,
    COUNT(DISTINCT cs.nct_id)::integer AS cnt
  FROM clinical_studies cs
  WHERE cs.project_number IS NOT NULL
  GROUP BY core_pn
)
UPDATE projects p
SET clinical_trial_count = sub.cnt
FROM normalized_trial_counts sub
WHERE regexp_replace(
        regexp_replace(
          regexp_replace(upper(trim(p.project_number)), '^[0-9]', ''),
          '-\d+$', ''
        ),
        '-[A-Z]\d+$', ''
      ) = sub.core_pn
  AND (p.clinical_trial_count IS NULL OR p.clinical_trial_count != sub.cnt);
