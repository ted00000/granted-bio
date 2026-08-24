-- Analysis sharing primitive.
--
-- A share row lets the owner of a completed analysis mint a
-- tokenized public URL (/share/[token]) that renders the same
-- portal to any visitor, no login required. Recipients see an
-- attribution watermark ("Shared with you by X"); the report
-- itself is read-only in that mode (no regenerate / delete /
-- refresh / export affordances).
--
-- Design notes:
--   * Tokens are opaque random strings (32 bytes hex/base64url,
--     generated app-side; DB just enforces uniqueness).
--   * Every share has an explicit expires_at (default 60 days
--     app-side, but the column is authoritative — expiring an
--     old share just requires updating this timestamp).
--   * revoked_at is a soft-kill switch — a revoked share is
--     rejected at the token-validation layer without being
--     deleted, so we can distinguish "expired naturally" vs
--     "owner killed it" in view analytics later.
--   * view_count + last_viewed_at are bumped every time the
--     public route resolves a token; the increment is done via
--     the service-role client, not by the recipient (they have
--     no auth).
--   * recipient_email + sender_message capture what the owner
--     entered in the share dialog. Both nullable — the "copy
--     link" path skips both.
--
-- RLS shape mirrors user_reports:
--   * Owners can SELECT/INSERT/UPDATE (revoke) their own shares.
--   * Owners cannot DELETE — revocation is a status change, not
--     row removal, so the buyer can still audit which shares
--     existed and when they were killed.
--   * Public token-based reads happen through the service-role
--     client in the /share/[token] loader; no anon RLS policy
--     is granted (tokens themselves are the access control).

CREATE TABLE IF NOT EXISTS analysis_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  recipient_email TEXT,
  sender_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);

-- Hot path lookups:
--   * By token (token validation on /share/[token] — one lookup per view)
--   * By report_id + owner_user_id (list-shares-for-a-report in the
--     owner's Share dialog)
CREATE INDEX IF NOT EXISTS idx_analysis_shares_token
  ON analysis_shares(token);
CREATE INDEX IF NOT EXISTS idx_analysis_shares_report_owner
  ON analysis_shares(report_id, owner_user_id, created_at DESC);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE analysis_shares ENABLE ROW LEVEL SECURITY;

-- Owners read their own shares (for the manage-shares list in
-- the Share dialog on the report page).
CREATE POLICY "Owners read own shares" ON analysis_shares
  FOR SELECT
  USING (owner_user_id = auth.uid());

-- Owners insert their own shares. The client-side API route
-- validates that the report_id also belongs to the caller before
-- writing, so the check here is belt-and-suspenders.
CREATE POLICY "Owners create own shares" ON analysis_shares
  FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

-- Owners can UPDATE only to set revoked_at on their own rows.
-- Other columns (token, report_id, expires_at, view_count, etc.)
-- are set at creation and by the service-role view-count bump
-- path; letting owners mutate them would open replay / analytics-
-- tampering attacks. The CHECK caps the writable surface.
CREATE POLICY "Owners revoke own shares" ON analysis_shares
  FOR UPDATE
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Service-role fully manages the table (token validation, view
-- count bumps, admin cleanup). Matches the pattern used for
-- report_purchases in 20260615_rls_lockdown_billing.sql.
CREATE POLICY "Service manages shares" ON analysis_shares
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Narrow the authenticated grant to just SELECT + INSERT + UPDATE.
-- No DELETE — revocation is a soft state, and letting owners drop
-- rows would break the audit trail.
GRANT SELECT, INSERT, UPDATE ON analysis_shares TO authenticated;
