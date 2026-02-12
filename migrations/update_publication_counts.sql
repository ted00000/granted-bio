-- Update publication counts in batches
-- Run this in the Supabase SQL Editor

UPDATE projects p
SET publication_count = sub.cnt
FROM (
  SELECT pp.project_number, COUNT(DISTINCT pp.pmid)::integer as cnt
  FROM project_publications pp
  GROUP BY pp.project_number
) sub
WHERE p.project_number = sub.project_number
  AND (p.publication_count IS NULL OR p.publication_count = 0);
