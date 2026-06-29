-- Update publication counts on projects.
--
-- IMPORTANT: This script joins projects.project_number to project_publications
-- via a CORE form derived in SQL. The projects table stores project_number in
-- MIXED format — some rows in core form, some in full form. Linkage tables
-- only store core. A naive equality join silently undercounts whenever a
-- project is stored in full form.
--
-- Use etl/fix_linked_counts.py for the canonical maintenance path.

WITH normalized_pub_counts AS (
  SELECT
    regexp_replace(
      regexp_replace(
        regexp_replace(upper(trim(pp.project_number)), '^[0-9]', ''),
        '-\d+$', ''
      ),
      '-[A-Z]\d+$', ''
    ) AS core_pn,
    COUNT(DISTINCT pp.pmid)::integer AS cnt
  FROM project_publications pp
  WHERE pp.project_number IS NOT NULL
  GROUP BY core_pn
)
UPDATE projects p
SET publication_count = sub.cnt
FROM normalized_pub_counts sub
WHERE regexp_replace(
        regexp_replace(
          regexp_replace(upper(trim(p.project_number)), '^[0-9]', ''),
          '-\d+$', ''
        ),
        '-[A-Z]\d+$', ''
      ) = sub.core_pn
  AND (p.publication_count IS NULL OR p.publication_count != sub.cnt);
