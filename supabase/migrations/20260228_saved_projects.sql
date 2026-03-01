-- Create saved_projects table for bookmarking projects
CREATE TABLE IF NOT EXISTS saved_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique saves per user per project
  UNIQUE(user_id, application_id)
);

-- Create index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_saved_projects_user_id ON saved_projects(user_id);

-- Create index for checking if a project is saved
CREATE INDEX IF NOT EXISTS idx_saved_projects_user_application ON saved_projects(user_id, application_id);

-- Enable RLS
ALTER TABLE saved_projects ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own saved projects
CREATE POLICY "Users can view own saved projects"
  ON saved_projects FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own saved projects
CREATE POLICY "Users can save projects"
  ON saved_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own saved projects
CREATE POLICY "Users can unsave projects"
  ON saved_projects FOR DELETE
  USING (auth.uid() = user_id);
