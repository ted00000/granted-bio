-- Phase 2 of the analysis-share primitive.
--
-- Adds two tables:
--   share_views — one row per resolved /share/[token] view, so we
--     can compute unique viewers (hashed IP + UA), first-viewed
--     timestamp, and per-country counts without keeping per-viewer
--     PII around.
--   share_rate_limits — sliding-window per-IP counter used by
--     middleware to throttle scraper-style hammering on the token
--     endpoint. Simple table-backed counter (no Redis/KV dep); rows
--     are self-expiring via a `bucket_started_at` window that the
--     middleware compares against on every hit.

-- ============================================================
-- share_views
-- ============================================================
--
-- One row per share-URL page load, ish. A "unique viewer" is a
-- distinct value of viewer_hash for a given share_id. viewer_hash =
-- HMAC-SHA256(server-side secret, `${ip}::${ua}`) — the raw IP and
-- UA never touch this table. Country is derived from the request's
-- x-vercel-ip-country header (accurate on Vercel Edge; falls back
-- to 'ZZ' if absent). No exposed timestamp precision beyond the
-- second — this is directional analytics, not audit logging.
CREATE TABLE IF NOT EXISTS share_views (
  id BIGSERIAL PRIMARY KEY,
  share_id UUID NOT NULL REFERENCES analysis_shares(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,
  country CHAR(2) NOT NULL DEFAULT 'ZZ',
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot-path indexes:
--   * By share_id + viewed_at for the "views over time" query.
--   * By share_id + viewer_hash for the unique-viewer computation
--     (SELECT COUNT(DISTINCT viewer_hash) ... WHERE share_id = ?).
CREATE INDEX IF NOT EXISTS idx_share_views_share_time
  ON share_views(share_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_views_share_hash
  ON share_views(share_id, viewer_hash);

ALTER TABLE share_views ENABLE ROW LEVEL SECURITY;

-- Owners read view rows for their own shares (used to render the
-- unique-viewer + country breakdown in the manage-shares list).
CREATE POLICY "Owners read own share views" ON share_views
  FOR SELECT
  USING (
    share_id IN (
      SELECT id FROM analysis_shares WHERE owner_user_id = auth.uid()
    )
  );

-- Only service-role writes. All view records come from the middleware
-- view-recording path which runs with the service key.
CREATE POLICY "Service manages share views" ON share_views
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

GRANT SELECT ON share_views TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE share_views_id_seq TO authenticated;


-- ============================================================
-- share_rate_limits
-- ============================================================
--
-- Table-backed sliding-window rate limit for /share/[token] token
-- resolution. Keyed on ip (Vercel Edge exposes x-forwarded-for /
-- x-real-ip / request.ip). Each row represents a rolling window:
-- middleware bumps `count` if the window hasn't expired, otherwise
-- resets the window. A configurable cap (currently 20/min) rejects
-- excess resolutions with 429.
--
-- No indexes on window_started_at because we prune by (ip) lookup
-- and let PG's UNIQUE index on ip do the work. Old rows can be
-- garbage-collected by a nightly cron once volume warrants it —
-- until then the table stays tiny.
CREATE TABLE IF NOT EXISTS share_rate_limits (
  ip TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE share_rate_limits ENABLE ROW LEVEL SECURITY;

-- Rate-limit rows are only ever touched by the service-role
-- middleware. No user-facing surface reads or writes them.
CREATE POLICY "Service manages rate limits" ON share_rate_limits
  FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
