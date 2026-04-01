-- API usage tracking for associate billing
-- Tracks token usage and costs per API call

-- Add 'associate' to role constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('user', 'admin', 'associate'));

-- API usage tracking table
CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- What was called
  endpoint TEXT NOT NULL,  -- 'chat', 'report'
  persona TEXT,            -- 'researcher', 'bd', 'investor', 'trials'

  -- Token counts from Anthropic API
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cache_write_tokens INT NOT NULL DEFAULT 0,

  -- Calculated cost in cents (e.g., 2.3456 cents)
  cost_cents NUMERIC(10,4) NOT NULL DEFAULT 0
);

-- Indexes for querying usage
CREATE INDEX IF NOT EXISTS idx_api_usage_user ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_created ON api_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at DESC);

-- Enable RLS
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own usage
DROP POLICY IF EXISTS "Users can read own usage" ON api_usage;
CREATE POLICY "Users can read own usage" ON api_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all usage
DROP POLICY IF EXISTS "Admins can read all usage" ON api_usage;
CREATE POLICY "Admins can read all usage" ON api_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Service role can insert (API routes use service key)
DROP POLICY IF EXISTS "Service can insert usage" ON api_usage;
CREATE POLICY "Service can insert usage" ON api_usage
  FOR INSERT
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON public.api_usage TO authenticated;
GRANT ALL ON public.api_usage TO service_role;

-- Comments
COMMENT ON TABLE api_usage IS 'Tracks API token usage and costs for billing associates';
COMMENT ON COLUMN api_usage.endpoint IS 'API endpoint: chat, report';
COMMENT ON COLUMN api_usage.cost_cents IS 'Calculated cost in cents based on Anthropic pricing';
