-- Lock down RLS on billing-adjacent tables.
--
-- The original policies on report_purchases, report_credits, and
-- retry_feedback were "Service can manage" with FOR ALL USING(true)
-- WITH CHECK(true), combined with GRANT ALL TO authenticated. Despite
-- the name, those policies have no service-role gate — they let any
-- signed-in user INSERT/UPDATE/DELETE arbitrary rows. The most direct
-- exploit:
--
--   INSERT INTO report_purchases (user_id, status, stripe_checkout_session_id)
--     VALUES (auth.uid(), 'completed', 'fake_session_id');
--
-- followed by POST /api/reports which checks for
-- status='completed' AND report_id IS NULL — bypassing Stripe and
-- minting a free $199 report on demand. Same shape on the credit
-- ledger (mint refresh / retry credits) and retry_feedback.
--
-- Fix: the service-role policy is rewritten to require that the
-- incoming JWT actually carries role='service_role' (which is set
-- by the Supabase service key but never by an authenticated user's
-- session). Plus the GRANT TO authenticated is narrowed to SELECT
-- only — they can still read their own rows via the existing
-- "Users read own" policies, but they cannot write.
--
-- Service-role code paths (webhook, crons, server-side routes using
-- supabaseAdmin) are unaffected: they connect with the service key
-- and either bypass RLS entirely (PostgreSQL service_role role) or
-- pass the auth.jwt() role check (PostgREST service_role JWT).

-- ============================================================
-- report_purchases
-- ============================================================

DROP POLICY IF EXISTS "Service can manage purchases" ON report_purchases;

-- INSERT/UPDATE/DELETE only via service-role JWT. Keep the
-- existing "Users can read own purchases" SELECT policy.
CREATE POLICY "Service writes purchases" ON report_purchases
  FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service updates purchases" ON report_purchases
  FOR UPDATE
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service deletes purchases" ON report_purchases
  FOR DELETE
  USING ((auth.jwt() ->> 'role') = 'service_role');

-- Narrow the grant. authenticated reads via the SELECT policy;
-- writes are denied at both grant and policy level.
REVOKE ALL ON public.report_purchases FROM authenticated;
GRANT SELECT ON public.report_purchases TO authenticated;
-- service_role keeps full access.
GRANT ALL ON public.report_purchases TO service_role;

-- ============================================================
-- report_credits
-- ============================================================

DROP POLICY IF EXISTS "Service manages credits" ON report_credits;

CREATE POLICY "Service writes credits" ON report_credits
  FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service updates credits" ON report_credits
  FOR UPDATE
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service deletes credits" ON report_credits
  FOR DELETE
  USING ((auth.jwt() ->> 'role') = 'service_role');

REVOKE ALL ON public.report_credits FROM authenticated;
GRANT SELECT ON public.report_credits TO authenticated;
GRANT ALL ON public.report_credits TO service_role;

-- ============================================================
-- retry_feedback
-- ============================================================

DROP POLICY IF EXISTS "Service manages retry feedback" ON retry_feedback;

CREATE POLICY "Service writes retry feedback" ON retry_feedback
  FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service updates retry feedback" ON retry_feedback
  FOR UPDATE
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service deletes retry feedback" ON retry_feedback
  FOR DELETE
  USING ((auth.jwt() ->> 'role') = 'service_role');

REVOKE ALL ON public.retry_feedback FROM authenticated;
GRANT SELECT ON public.retry_feedback TO authenticated;
GRANT ALL ON public.retry_feedback TO service_role;

-- ============================================================
-- Verification queries (informational — for the operator running
-- this migration to confirm the policies are in place):
--
--   SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
--          pg_get_expr(polwithcheck, polrelid) AS check_expr
--     FROM pg_policy
--    WHERE polrelid IN (
--      'public.report_purchases'::regclass,
--      'public.report_credits'::regclass,
--      'public.retry_feedback'::regclass
--    );
-- ============================================================
