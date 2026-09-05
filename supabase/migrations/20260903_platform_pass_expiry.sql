-- Platform-pass expiry model (2026-09-03).
--
-- Every $199 analysis purchase now gives the buyer a 3-month
-- "platform pass" — during that window they get Pro-tier search
-- (500/mo), full drill-down on every linked record, and Refresh/
-- Retry credit usage. After the window expires they retain access
-- to their generated analyses (per-report drill-down is on the
-- artifact side, not gated by the pass), but the search quota
-- drops back to the free tier and any new analysis requires
-- another $199 purchase.
--
-- Behavior chosen: RESET (not stack). Each purchase sets
-- platform_pass_expires_at = NOW() + 90 days regardless of
-- current value. Someone who has 60 days remaining and buys again
-- doesn't accumulate 150 days — they get a fresh 90 from the new
-- purchase date. Simpler promise: "every purchase = 3 months from
-- that date."
--
-- Backfill sets the expiry for existing paid users based on the
-- MOST RECENT completed report_purchase — a customer's most-recent
-- purchase is what defines their current pass window. For users
-- whose latest purchase is already >90 days old, the expiry lands
-- in the past (already expired), which correctly reflects that
-- they'd need to renew.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS platform_pass_expires_at TIMESTAMPTZ;

-- Hot path: "is this user currently on an active pass?"
-- Partial index because most reads on this column are the "is
-- pass active right now" check and the great majority of profiles
-- either have NULL (no purchases yet) or an expired value.
CREATE INDEX IF NOT EXISTS idx_user_profiles_pass_active
  ON user_profiles (platform_pass_expires_at)
  WHERE platform_pass_expires_at IS NOT NULL;

-- Backfill from most-recent completed report_purchase per user.
-- 'DISTINCT ON' keeps only the newest completed_at per user_id.
UPDATE user_profiles p
   SET platform_pass_expires_at = latest.completed_at + INTERVAL '90 days'
  FROM (
    SELECT DISTINCT ON (user_id)
      user_id,
      completed_at
      FROM report_purchases
     WHERE status = 'completed'
       AND completed_at IS NOT NULL
     ORDER BY user_id, completed_at DESC
  ) latest
 WHERE p.id = latest.user_id;

COMMENT ON COLUMN user_profiles.platform_pass_expires_at IS
  'When the current 3-month platform pass expires. Each $199 report purchase resets this to NOW()+90 days. NULL for users who have never purchased. When NOW() < this value, treat the user as Pro tier for search-quota purposes.';
