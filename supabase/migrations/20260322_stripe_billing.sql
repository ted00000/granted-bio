-- Stripe billing integration
-- Adds Stripe customer/subscription tracking and report purchases table

-- Add Stripe-related columns to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing', NULL)),
ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- Index for Stripe customer lookup (webhook handler needs this)
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id);

-- Report purchases table (decoupled from subscription)
-- Each purchase is a one-time $99 payment for a single report
CREATE TABLE IF NOT EXISTS report_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  report_id UUID REFERENCES user_reports(id) ON DELETE SET NULL,
  topic TEXT,  -- Store topic at purchase time (before report generated)
  persona TEXT CHECK (persona IN ('researcher', 'investor')),
  amount_cents INT NOT NULL DEFAULT 9900,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for report_purchases
CREATE INDEX IF NOT EXISTS idx_report_purchases_user ON report_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_report_purchases_status ON report_purchases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_report_purchases_checkout ON report_purchases(stripe_checkout_session_id);

-- Enable RLS on report_purchases
ALTER TABLE report_purchases ENABLE ROW LEVEL SECURITY;

-- Users can read their own purchases
DROP POLICY IF EXISTS "Users can read own purchases" ON report_purchases;
CREATE POLICY "Users can read own purchases" ON report_purchases
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert/update (webhook handler)
-- Note: Use service key for webhook operations
DROP POLICY IF EXISTS "Service can manage purchases" ON report_purchases;
CREATE POLICY "Service can manage purchases" ON report_purchases
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON public.report_purchases TO authenticated;
GRANT ALL ON public.report_purchases TO service_role;

-- Comments
COMMENT ON TABLE report_purchases IS 'Tracks $99 one-time report purchases via Stripe';
COMMENT ON COLUMN report_purchases.stripe_checkout_session_id IS 'Stripe checkout session ID for webhook matching';
COMMENT ON COLUMN report_purchases.topic IS 'Report topic stored at purchase time';
COMMENT ON COLUMN report_purchases.status IS 'pending (checkout started), completed (paid), refunded, failed';
