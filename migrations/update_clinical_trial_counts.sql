-- Update clinical trial counts in batches
-- Run this in the Supabase SQL Editor

UPDATE projects p
SET clinical_trial_count = sub.cnt
FROM (
  SELECT cs.project_number, COUNT(DISTINCT cs.nct_id)::integer as cnt
  FROM clinical_studies cs
  GROUP BY cs.project_number
) sub
WHERE p.project_number = sub.project_number
  AND (p.clinical_trial_count IS NULL OR p.clinical_trial_count = 0);
