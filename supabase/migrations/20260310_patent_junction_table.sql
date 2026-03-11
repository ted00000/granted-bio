-- Create project_patents junction table for proper many-to-many relationship
-- Patents can link to multiple projects, and projects can have multiple patents

-- Step 1: Create the junction table
CREATE TABLE IF NOT EXISTS project_patents (
    project_number TEXT NOT NULL,
    patent_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (project_number, patent_id)
);

-- Step 2: Migrate existing links from patents table
INSERT INTO project_patents (project_number, patent_id)
SELECT DISTINCT project_number, patent_id
FROM patents
WHERE project_number IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 3: Remove project_number from patents table (keep metadata only)
ALTER TABLE patents DROP COLUMN IF EXISTS project_number;

-- Step 4: Add index for lookups
CREATE INDEX IF NOT EXISTS idx_project_patents_project ON project_patents(project_number);
CREATE INDEX IF NOT EXISTS idx_project_patents_patent ON project_patents(patent_id);

-- Step 5: Add foreign key to patents table
ALTER TABLE project_patents
ADD CONSTRAINT fk_project_patents_patent
FOREIGN KEY (patent_id) REFERENCES patents(patent_id) ON DELETE CASCADE;
