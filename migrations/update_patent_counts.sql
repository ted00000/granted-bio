-- Update patent counts in batches
-- Run this in the Supabase SQL Editor

UPDATE projects p
SET patent_count = sub.cnt
FROM (
  SELECT pat.project_number, COUNT(DISTINCT pat.patent_id)::integer as cnt
  FROM patents pat
  GROUP BY pat.project_number
) sub
WHERE p.project_number = sub.project_number
  AND (p.patent_count IS NULL OR p.patent_count = 0);
