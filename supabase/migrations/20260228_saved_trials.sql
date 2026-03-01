-- Create saved_trials table for bookmarking clinical trials
CREATE TABLE IF NOT EXISTS saved_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nct_id TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure unique saves per user per trial
  UNIQUE(user_id, nct_id)
);

-- Create index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_saved_trials_user_id ON saved_trials(user_id);

-- Create index for checking if a trial is saved
CREATE INDEX IF NOT EXISTS idx_saved_trials_user_nct ON saved_trials(user_id, nct_id);

-- Enable RLS
ALTER TABLE saved_trials ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own saved trials
CREATE POLICY "Users can view own saved trials"
  ON saved_trials FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own saved trials
CREATE POLICY "Users can save trials"
  ON saved_trials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own saved trials
CREATE POLICY "Users can unsave trials"
  ON saved_trials FOR DELETE
  USING (auth.uid() = user_id);
