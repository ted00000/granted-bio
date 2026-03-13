-- Create saved_people table for bookmarking researchers
CREATE TABLE IF NOT EXISTS saved_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  person_type TEXT NOT NULL DEFAULT 'researcher', -- 'researcher' or 'organization'
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique saves per user per person
  UNIQUE(user_id, person_name, person_type)
);

-- Create index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_saved_people_user_id ON saved_people(user_id);

-- Create index for checking if a person is saved
CREATE INDEX IF NOT EXISTS idx_saved_people_user_name ON saved_people(user_id, person_name, person_type);

-- Enable RLS
ALTER TABLE saved_people ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own saved people
CREATE POLICY "Users can view own saved people"
  ON saved_people FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own saved people
CREATE POLICY "Users can save people"
  ON saved_people FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own saved people
CREATE POLICY "Users can unsave people"
  ON saved_people FOR DELETE
  USING (auth.uid() = user_id);
