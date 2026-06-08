-- Phase 2 of the landing+credits redesign (see docs/LANDING_AND_CREDITS_PLAN.md).
--
-- Introduces a credit ledger that captures every entitlement granted by a
-- purchase, admin grant, or auto-grant. Existing report_purchases stays as
-- the Stripe payment audit trail; report_credits is the entitlement record
-- that downstream features (refresh in Phase 3, retry in Phase 3, bulk in
-- Phase 5) read against.
--
-- Phase 2 is intentionally "shadow ledger" — credits are written alongside
-- the existing webhook + API flow, but consumed immediately so the UX is
-- unchanged from today's "pay → see report" experience. The ledger captures
-- the data needed for Phase 3's refresh entitlement and retry assistant
-- without changing what happens between checkout and the report appearing.

CREATE TABLE IF NOT EXISTS report_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- generation: spendable on any topic + interpretation
  -- refresh: bound to a specific generated report; consumable to re-synthesize
  --   that report's topic with current NIH data, same interpretation
  -- retry: bound to a specific original report; consumed via the AI-assisted
  --   refinement flow to regenerate with a refined interpretation
  credit_type TEXT NOT NULL CHECK (credit_type IN ('generation', 'refresh', 'retry')),

  source TEXT NOT NULL CHECK (source IN (
    'purchase',
    'bulk_purchase',
    'admin_grant',
    'beta_grant',
    'failure_auto_grant',
    'self_serve_retry',
    'promo',
    'legacy_migration'
  )),

  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Set when the credit is spent. The consumed_for_report_id is whichever
  -- user_reports row the credit produced (gen credits) or refreshed/retried.
  consumed_at TIMESTAMPTZ,
  consumed_for_report_id UUID REFERENCES user_reports(id) ON DELETE SET NULL,

  -- Refresh credits get bound to a specific report at generation time. The
  -- credit can later be spent (consumed_at + consumed_for_report_id of the
  -- regenerated report) to refresh ONLY that bound report's topic.
  bound_to_report_id UUID REFERENCES user_reports(id) ON DELETE SET NULL,

  -- Retry credits track which report triggered the retry so we can surface
  -- "you used your retry on report X" in admin / support tooling.
  original_report_id UUID REFERENCES user_reports(id) ON DELETE SET NULL,

  -- Stripe linkage for purchase audit trail. A single checkout session can
  -- spawn multiple credit rows (bulk SKUs in Phase 5 will grant N gen + N
  -- refresh from one session).
  stripe_session_id TEXT,
  stripe_price_id TEXT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "does this user have any unused credits right now?"
-- The predicate intentionally omits an expires_at check: NOW() is STABLE
-- (not IMMUTABLE), and Postgres rejects non-IMMUTABLE functions in partial
-- index predicates because the predicate would silently go stale over time.
-- Queries against this index still filter `expires_at > NOW()` at runtime;
-- the index is just marginally broader than the minimal "currently-spendable"
-- set, which is irrelevant at the volumes this table will see.
CREATE INDEX IF NOT EXISTS idx_report_credits_user_unused
  ON report_credits (user_id)
  WHERE consumed_at IS NULL;

-- Hot path: find a refresh entitlement for a specific report
CREATE INDEX IF NOT EXISTS idx_report_credits_bound_report
  ON report_credits (bound_to_report_id)
  WHERE bound_to_report_id IS NOT NULL AND consumed_at IS NULL;

-- Hot path: idempotency check by Stripe session
CREATE INDEX IF NOT EXISTS idx_report_credits_stripe_session
  ON report_credits (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

ALTER TABLE report_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own credits" ON report_credits;
CREATE POLICY "Users read own credits" ON report_credits
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service manages credits" ON report_credits;
CREATE POLICY "Service manages credits" ON report_credits
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.report_credits TO authenticated;
GRANT ALL ON public.report_credits TO service_role;

-- Convenience view: per-user counts of currently-spendable credits.
-- Used by the header credit badge (Phase 5 bulk SKUs will make this
-- non-zero for typical buyers; Phase 2 shadow-ledger keeps it at 0
-- because credits are consumed immediately during generation).
CREATE OR REPLACE VIEW user_available_credits AS
SELECT
  user_id,
  COUNT(*) FILTER (
    WHERE credit_type = 'generation'
      AND consumed_at IS NULL
      AND expires_at > NOW()
  )::INT AS generation_credits,
  COUNT(*) FILTER (
    WHERE credit_type = 'retry'
      AND consumed_at IS NULL
      AND expires_at > NOW()
  )::INT AS retry_credits
FROM report_credits
GROUP BY user_id;

GRANT SELECT ON public.user_available_credits TO authenticated;
GRANT SELECT ON public.user_available_credits TO service_role;

-- One-time backfill: every previously-completed report purchase gets a
-- consumed generation credit (so the ledger reflects the historical
-- generation) plus an unbound refresh entitlement bound to that report
-- (so historical buyers get the same refresh value going forward as new
-- buyers). Expiration is 12 months from the purchase completion.
--
-- The refresh entitlement is bound at insert time to the specific report
-- that the original purchase produced, so it can only refresh that one.
-- If the original purchase has no linked report (status='completed' but
-- generation failed), only the generation credit is created and it's
-- marked consumed against a NULL report — preserves the audit trail
-- without granting a refresh on a report that never materialized.
INSERT INTO report_credits (
  user_id, credit_type, source,
  granted_at, expires_at, consumed_at, consumed_for_report_id,
  stripe_session_id, notes
)
SELECT
  user_id,
  'generation',
  'legacy_migration',
  completed_at,
  completed_at + INTERVAL '12 months',
  completed_at,
  report_id,
  stripe_checkout_session_id,
  'Backfilled from report_purchases at Phase 2 deploy'
FROM report_purchases
WHERE status = 'completed' AND completed_at IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO report_credits (
  user_id, credit_type, source,
  granted_at, expires_at, bound_to_report_id,
  stripe_session_id, notes
)
SELECT
  user_id,
  'refresh',
  'legacy_migration',
  completed_at,
  completed_at + INTERVAL '12 months',
  report_id,
  stripe_checkout_session_id,
  'Backfilled from report_purchases at Phase 2 deploy — refresh entitlement granted retroactively to historical buyers'
FROM report_purchases
WHERE status = 'completed' AND completed_at IS NOT NULL AND report_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE report_credits IS
  'Entitlement ledger. One row per credit granted by a purchase, admin/beta bypass, or auto-grant. Consumed credits keep their row for audit; the consumed_at timestamp and consumed_for_report_id capture what they produced.';

COMMENT ON COLUMN report_credits.credit_type IS
  'generation = spend on any topic; refresh = bound to a specific report; retry = bound to a specific original report, consumed via AI-assisted refinement.';

COMMENT ON COLUMN report_credits.bound_to_report_id IS
  'For refresh credits: the report this entitlement can refresh. For generation credits: NULL (they bind nothing — they produce a new report via consumed_for_report_id).';

COMMENT ON VIEW user_available_credits IS
  'Per-user count of currently-spendable credits. Reads against this view drive the header credit badge.';
