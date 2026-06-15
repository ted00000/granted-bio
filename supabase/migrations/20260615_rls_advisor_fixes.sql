-- Resolve the two Critical findings from Supabase's Security Advisor:
--   1) public.project_patents — RLS not enabled
--   2) public.user_available_credits — view runs as SECURITY DEFINER
--
-- Both date from earlier migrations (20260310 and 20260608) that
-- predate the RLS lockdown work we did on 2026-06-15.

-- =========================================================================
-- Fix 1: project_patents
-- =========================================================================
-- This is a junction table linking NIH project numbers to USPTO patent IDs.
-- The relationships are public reference data (USPTO + RePORTER are both
-- public), so the policy intentionally exposes every row to any
-- authenticated reader. Service role bypasses RLS as usual.
--
-- All writes go through the ETL pipeline which uses service_role, so no
-- INSERT/UPDATE/DELETE policy is needed (and would be wrong — we don't
-- want authenticated users mutating junction rows).

ALTER TABLE public.project_patents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_patents_public_read"
  ON public.project_patents
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- =========================================================================
-- Fix 2: user_available_credits
-- =========================================================================
-- The view aggregates report_credits per user. Without security_invoker,
-- it runs with the privileges of the view owner (postgres), which bypasses
-- the RLS policies on report_credits and lets any authenticated reader
-- aggregate counts for every user in the system.
--
-- Recreating with security_invoker = on makes the view honor the caller's
-- privileges, so the existing RLS on report_credits (user_id = auth.uid())
-- naturally scopes results to the caller's own credit ledger.

DROP VIEW IF EXISTS public.user_available_credits;

CREATE VIEW public.user_available_credits
WITH (security_invoker = on)
AS
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
FROM public.report_credits
GROUP BY user_id;

GRANT SELECT ON public.user_available_credits TO authenticated;
GRANT SELECT ON public.user_available_credits TO service_role;

COMMENT ON VIEW public.user_available_credits IS
  'Per-user count of currently-spendable credits. security_invoker=on so RLS on report_credits scopes results to the caller.';
