-- Add secondary_category column for ambiguous classifications
-- Projects with close scores get a secondary category assigned

ALTER TABLE projects ADD COLUMN IF NOT EXISTS secondary_category TEXT;

-- Create index for filtering by secondary category
CREATE INDEX IF NOT EXISTS idx_projects_secondary_category ON projects(secondary_category) WHERE secondary_category IS NOT NULL;
