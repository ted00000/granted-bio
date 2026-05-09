-- Auto-revert expired beta users to 'free' tier.
-- Called once per sign-in (via auth callback) on the current user only —
-- O(1) cost, no full-table sweep. Users who never sign in again stay
-- at tier='beta' in the DB, but the application layer already enforces
-- expiry at access time, so it has no functional impact.

CREATE OR REPLACE FUNCTION public.expire_user_beta_if_stale(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_reverted BOOLEAN := FALSE;
BEGIN
  UPDATE user_profiles
  SET tier = 'free',
      tier_updated_at = NOW(),
      beta_claimed_at = NULL,
      beta_expires_at = NULL,
      updated_at = NOW()
  WHERE id = p_user_id
    AND tier = 'beta'
    AND beta_expires_at IS NOT NULL
    AND beta_expires_at < NOW();

  IF FOUND THEN
    v_was_reverted := TRUE;
  END IF;

  RETURN v_was_reverted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_user_beta_if_stale TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_user_beta_if_stale TO service_role;

COMMENT ON FUNCTION public.expire_user_beta_if_stale IS 'Reverts a single user from beta to free if their beta_expires_at has passed. Called from the auth callback on each sign-in.';
