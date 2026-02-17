-- Migration: Fix organizations incorrectly classified as "company"
-- Run each UPDATE separately in Supabase SQL Editor to avoid timeout
-- This migration was run on 2026-02-15 and fixed 2,379 records

-- ============================================
-- UNIVERSITIES
-- ============================================

-- STEP 1a: Fix "UNIVERSITY"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%UNIVERSITY%';

-- STEP 1b: Fix "UNIV OF" pattern (e.g., "UNIV OF NORTH CAROLINA CHAPEL HILL")
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'UNIV OF%';

-- STEP 1c: Fix other "UNIV " patterns (e.g., "UNIV AT BUFFALO")
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'UNIV %';

-- STEP 1d: Fix COLUMBIA UNIV
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'COLUMBIA UNIV%';

-- STEP 1e: Fix TEMPLE UNIV
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'TEMPLE UNIV%';

-- STEP 1f: Fix RUTGERS STATE UNIV
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'RUTGERS%STATE UNIV%';

-- STEP 2: Fix "COLLEGE"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%COLLEGE%';

-- STEP 3: Fix "SCHOOL OF MEDICINE" and "MEDICAL SCHOOL"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND (org_name ILIKE '%SCHOOL OF MEDICINE%' OR org_name ILIKE '%MEDICAL SCHOOL%');

-- STEP 4a: Fix "INSTITUTE OF TECHNOLOGY"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%INSTITUTE OF TECHNOLOGY%';

-- STEP 4b: Fix "POLYTECHNIC INST"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%POLYTECHNIC INST%';

-- STEP 4c: Fix "MEDICAL COLL" (e.g., WEILL MEDICAL COLL)
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%MEDICAL COLL%';

-- STEP 4d: Fix "BIOMEDICAL AND HEALTH SCIENCES" (e.g., RUTGERS)
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE '%BIOMEDICAL AND HEALTH SCIENCES%';

-- STEP 4e: Fix "LSU HEALTH"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'LSU HEALTH%';

-- STEP 4f: Fix "TEXAS A&M"
UPDATE projects
SET org_type = 'university'
WHERE org_type = 'company'
  AND org_name ILIKE 'TEXAS A&M%';

-- ============================================
-- RESEARCH INSTITUTES
-- ============================================

-- STEP 5a: Fix "INSTITUTE FOR MEDICAL RESEARCH" (e.g., "STOWERS INSTITUTE FOR MEDICAL RESEARCH")
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%INSTITUTE FOR MEDICAL RESEARCH%';

-- STEP 5b: Fix "INST FOR" patterns (research-focused institutes)
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%INST FOR%';

-- STEP 5c: Fix "RESEARCH INSTITUTE"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%RESEARCH INSTITUTE%';

-- STEP 5d: Fix "RESEARCH FOUNDATION"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%RESEARCH FOUNDATION%';

-- STEP 5e: Fix "RESEARCH INST"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%RESEARCH INST%';

-- STEP 5f: Fix "LABORATORY"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%LABORATORY%';

-- STEP 5g: Fix remaining "INSTITUTE" patterns
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%INSTITUTE%';

-- STEP 5h: Fix "VETERANS INSTIT"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%VETERANS INSTIT%';

-- STEP 5i: Fix "GENOME CENTER"
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name ILIKE '%GENOME CENTER%';

-- STEP 5j: Fix known research institutes by name
UPDATE projects
SET org_type = 'research_institute'
WHERE org_type = 'company'
  AND org_name IN (
    'BROAD INSTITUTE, INC.',
    'WISTAR INSTITUTE',
    'JACKSON LABORATORY',
    'RESEARCH TRIANGLE INSTITUTE',
    'SANFORD BURNHAM PREBYS MEDICAL DISCOVERY INSTITUTE',
    'SRI INTERNATIONAL',
    'ADA FORSYTH INSTITUTE, INC.'
  );

-- ============================================
-- HOSPITALS / MEDICAL CENTERS
-- ============================================

-- STEP 6a: Fix HOSPITAL
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%HOSPITAL%';

-- STEP 6b: Fix MEDICAL CENTER
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%MEDICAL CENTER%';

-- STEP 6c: Fix CHILDRENS
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%CHILDRENS%';

-- STEP 6d: Fix MED CTR
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%MED CTR%';

-- STEP 6e: Fix CLINIC
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%CLINIC%';

-- STEP 6f: Fix HEALTH SYSTEM
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%HEALTH SYSTEM%';

-- STEP 6g: Fix CANCER CENTER
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND (org_name ILIKE '%CANCER CENTER%'
    OR org_name ILIKE '%CANCER RESEARCH%'
    OR org_name ILIKE '%CAN RESEARCH%');

-- STEP 6h: Fix CANCER INST (e.g., DANA-FARBER CANCER INST)
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%CANCER INST%';

-- STEP 6i: Fix CANCER CTR
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%CANCER CTR%';

-- STEP 6j: Fix CAN CTR
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%CAN CTR%';

-- STEP 6k: Fix INFIRMARY
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%INFIRMARY%';

-- STEP 6l: Fix DIABETES CENTER
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE '%DIABETES CENTER%';

-- STEP 6m: Fix MAGEE-WOMEN'S
UPDATE projects
SET org_type = 'hospital'
WHERE org_type = 'company'
  AND org_name ILIKE 'MAGEE-WOMEN%';

-- ============================================
-- VERIFICATION
-- ============================================

-- STEP 7: Verify distribution (run last)
SELECT org_type, COUNT(*) as count
FROM projects
GROUP BY org_type
ORDER BY count DESC;

-- STEP 8: Check for remaining misclassified companies (should be actual companies)
-- Look for patterns that might need additional rules
SELECT org_name, COUNT(*) as project_count
FROM projects
WHERE org_type = 'company'
  AND org_name IS NOT NULL
GROUP BY org_name
ORDER BY project_count DESC
LIMIT 50;
