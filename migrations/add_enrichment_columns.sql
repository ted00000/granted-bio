-- Migration: Add enrichment columns directly to projects table
-- This approach uses less disk space than a materialized view

-- Step 1: Add columns to projects table (if they don't exist)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS publication_count INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS patent_count INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS clinical_trial_count INTEGER DEFAULT 0;

-- Step 2: Create indexes for these columns
CREATE INDEX IF NOT EXISTS idx_projects_publication_count ON projects(publication_count);
CREATE INDEX IF NOT EXISTS idx_projects_patent_count ON projects(patent_count);
CREATE INDEX IF NOT EXISTS idx_projects_clinical_trial_count ON projects(clinical_trial_count);
