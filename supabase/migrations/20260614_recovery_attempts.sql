-- Recovery counter for the stuck-purchase cron.
--
-- The webhook handler claims the purchase atomically, then runs
-- report generation in a Vercel `after()` background context. In the
-- rare case that the background work dies before linking the report
-- (function instance killed, infrastructure hiccup), the cron at
-- /api/cron/recover-stuck-purchases finds the purchase (status =
-- 'completed' but report_id IS NULL beyond a grace window) and
-- re-runs generation. This counter caps the retry attempts so a
-- truly broken purchase (e.g., bad metadata) doesn't loop forever.

ALTER TABLE report_purchases
  ADD COLUMN IF NOT EXISTS recovery_attempts INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN report_purchases.recovery_attempts IS
  'Number of times the stuck-purchase cron has retried generation. Capped (currently 3) by the cron itself.';

-- Index supports the cron's lookup: completed purchases without a
-- linked report, oldest first.
CREATE INDEX IF NOT EXISTS idx_report_purchases_stuck
  ON report_purchases (status, completed_at)
  WHERE status = 'completed' AND report_id IS NULL;
