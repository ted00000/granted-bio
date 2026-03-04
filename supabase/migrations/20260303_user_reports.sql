-- User Reports table for Intelligence Reports feature
-- Stores generated research landscape reports

CREATE TABLE user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Report metadata
  title VARCHAR(500) NOT NULL,
  report_type VARCHAR(20) NOT NULL,  -- 'topic' or 'portfolio'
  topic TEXT,                         -- Research topic (for topic reports)

  -- Report sections (structured)
  executive_summary TEXT,
  market_context JSONB,              -- External research findings
  funding_stats JSONB,               -- {total, project_count, by_year, by_org}
  projects JSONB,                    -- Top projects with abstracts
  clinical_trials JSONB,             -- Trials by phase
  patents JSONB,                     -- Patent filings
  publications JSONB,                -- Papers
  top_organizations JSONB,           -- Aggregated org stats
  top_researchers JSONB,             -- PI stats

  -- Full markdown report
  markdown_content TEXT,             -- Complete rendered report

  -- Agent outputs (for debugging/transparency)
  agent_outputs JSONB,               -- Raw outputs from each agent

  -- Generation metadata
  data_limited BOOLEAN DEFAULT FALSE, -- User accepted < 5 projects warning
  project_count INT,                  -- Number of projects found

  -- Status
  status VARCHAR(20) DEFAULT 'generating',  -- 'generating', 'complete', 'failed'
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON user_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
  ON user_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON user_reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
  ON user_reports FOR DELETE
  USING (auth.uid() = user_id);

-- Index for listing user's reports
CREATE INDEX idx_user_reports_user_id ON user_reports(user_id, created_at DESC);

-- Index for filtering by status
CREATE INDEX idx_user_reports_status ON user_reports(user_id, status);

-- Comment
COMMENT ON TABLE user_reports IS 'Stores generated intelligence reports for premium users';
