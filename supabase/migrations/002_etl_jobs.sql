-- ETL Jobs table for tracking data processing
CREATE TABLE IF NOT EXISTS etl_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  config JSONB DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_etl_jobs_status ON etl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_etl_jobs_created_at ON etl_jobs(created_at DESC);

-- Enable RLS
ALTER TABLE etl_jobs ENABLE ROW LEVEL SECURITY;

-- Only admins can view ETL jobs
CREATE POLICY "Admins can view etl_jobs" ON etl_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Only admins can insert/update ETL jobs
CREATE POLICY "Admins can insert etl_jobs" ON etl_jobs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can update etl_jobs" ON etl_jobs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Enable realtime for etl_jobs
ALTER PUBLICATION supabase_realtime ADD TABLE etl_jobs;
