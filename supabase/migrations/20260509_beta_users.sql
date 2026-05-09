-- Beta users: invitation-based access with pro-tier search limits,
-- a 14-day window from first sign-in, and a lifetime cap of 3 reports.

-- 1. Add 'beta' to the existing user_tier enum.
-- ALTER TYPE ... ADD VALUE works in a transaction on Postgres 12+.
ALTER TYPE user_tier ADD VALUE IF NOT EXISTS 'beta';

-- 2. Add beta tracking columns to user_profiles.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS beta_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_expires_at TIMESTAMPTZ;

-- 3. beta_invites table — admin-managed allowlist by email.
-- Pending invites have claimed_at NULL; promoted on the user's first sign-in.
CREATE TABLE IF NOT EXISTS beta_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  invited_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Lookups by email (sign-in promotion check) and by claimed status (admin list filtering)
CREATE INDEX IF NOT EXISTS idx_beta_invites_email ON beta_invites(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_beta_invites_claimed ON beta_invites(claimed_at);

-- RLS: admin-only management.
ALTER TABLE beta_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage beta invites"
  ON beta_invites FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- 4. RPC to atomically promote a user to beta when they sign in
-- with an invited email. Service-role function so it can update both tables.
CREATE OR REPLACE FUNCTION public.claim_beta_invite(p_user_id UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id UUID;
BEGIN
  -- Match invite by email (case-insensitive), only if not already claimed
  SELECT id INTO v_invite_id
  FROM beta_invites
  WHERE LOWER(email) = LOWER(p_email)
    AND claimed_at IS NULL
  LIMIT 1;

  IF v_invite_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Mark invite as claimed
  UPDATE beta_invites
  SET claimed_at = NOW(),
      claimed_by_user_id = p_user_id,
      updated_at = NOW()
  WHERE id = v_invite_id;

  -- Promote user (only if they're currently 'free' — don't downgrade pro users)
  UPDATE user_profiles
  SET tier = 'beta',
      tier_updated_at = NOW(),
      beta_claimed_at = NOW(),
      beta_expires_at = NOW() + INTERVAL '14 days',
      updated_at = NOW()
  WHERE id = p_user_id
    AND tier = 'free';

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_beta_invite TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_beta_invite TO service_role;

COMMENT ON TABLE beta_invites IS 'Admin-managed allowlist for beta-tier access. Users get pro search limits, 14 days from first sign-in, and a 3-report lifetime cap.';
COMMENT ON COLUMN user_profiles.beta_claimed_at IS 'When the user first claimed their beta invite (null for non-beta users).';
COMMENT ON COLUMN user_profiles.beta_expires_at IS 'When the beta access expires (claimed_at + 14 days). After this, the user reverts to free at the API layer.';
