-- Add supplement tracking to projects table
-- This allows us to identify and filter supplements (additional funding)
-- Supplements have FULL_PROJECT_NUM ending in S1, S2, etc.

ALTER TABLE projects
  ADD COLUMN is_supplement BOOLEAN DEFAULT false,
  ADD COLUMN supplement_number VARCHAR(10);

-- Add index for filtering by supplements
CREATE INDEX idx_projects_is_supplement ON projects(is_supplement);

-- Add comments
COMMENT ON COLUMN projects.is_supplement IS 'True if this is a supplement grant (additional funding on top of base grant)';
COMMENT ON COLUMN projects.supplement_number IS 'Supplement identifier (e.g., S1, S2) extracted from FULL_PROJECT_NUM';
