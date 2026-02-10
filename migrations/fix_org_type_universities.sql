-- Migration: Fix universities incorrectly classified as "company"
-- Run this in Supabase SQL Editor

-- Fix organizations with "UNIVERSITY" in name
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%UNIVERSITY%';

-- Fix organizations with "COLLEGE" in name
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%COLLEGE%';

-- Fix organizations with " UNIV " or "UNIV," in name
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND (org_name ILIKE '% UNIV %' OR org_name ILIKE '%UNIV,%');

-- Fix medical schools
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND (org_name ILIKE '%SCHOOL OF MEDICINE%' OR org_name ILIKE '%MEDICAL SCHOOL%');

-- Fix institutes of technology (MIT, Caltech, Georgia Tech, etc.)
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%INSTITUTE OF TECHNOLOGY%';

-- Fix hospitals incorrectly marked as company
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND (org_name ILIKE '%HOSPITAL%' OR org_name ILIKE '%MEDICAL CENTER%' OR org_name ILIKE '%CLINIC%');

-- Verify the fix
SELECT org_type, COUNT(*) as count
FROM projects
GROUP BY org_type
ORDER BY count DESC;
