-- Migration: Fix universities incorrectly classified as "company"
-- Run each UPDATE separately in Supabase SQL Editor to avoid timeout

-- STEP 1: Fix "UNIVERSITY" (run this first)
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%UNIVERSITY%';

-- STEP 2: Fix "COLLEGE" (run this second)
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%COLLEGE%';

-- STEP 3: Fix "SCHOOL OF MEDICINE" and "MEDICAL SCHOOL"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND (org_name ILIKE '%SCHOOL OF MEDICINE%' OR org_name ILIKE '%MEDICAL SCHOOL%');

-- STEP 4: Fix "INSTITUTE OF TECHNOLOGY"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%INSTITUTE OF TECHNOLOGY%';

-- STEP 5: Fix hospitals (including children's hospitals, medical centers)
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND (
    org_name ILIKE '%HOSPITAL%'
    OR org_name ILIKE '%MEDICAL CENTER%'
    OR org_name ILIKE '%CHILDRENS%'
    OR org_name ILIKE '%CHILDREN''S%'
    OR org_name ILIKE '%MED CTR%'
    OR org_name ILIKE '%CLINIC%'
    OR org_name ILIKE '%HEALTH SYSTEM%'
  );

-- STEP 6: Verify (run last)
SELECT org_type, COUNT(*) as count
FROM projects
GROUP BY org_type
ORDER BY count DESC;
