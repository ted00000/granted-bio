-- Retry feedback ledger for the AI-assisted retry flow.
--
-- Persists what the user complained about, what Claude proposed in response,
-- which alternative they chose, and what report it produced. Captures the
-- learning signal needed to improve the retry assistant over time AND keeps
-- a per-retry audit trail tied to the credit that funded it.
--
-- One row per retry submission. The row is created at "refine" step
-- (feedback submitted, Claude proposals returned). chosen_interpretation
-- and resulting_report_id are populated when the user proceeds to the
-- "generate" step. A row with NULL resulting_report_id means the user
-- gave us feedback but didn't follow through to generation — useful
-- signal in its own right.

CREATE TABLE IF NOT EXISTS retry_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The report the retry is for. Required.
  original_report_id UUID NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,

  -- What the user told us went wrong.
  feedback_category TEXT NOT NULL CHECK (feedback_category IN (
    'projects_wrong',
    'too_narrow',
    'too_broad',
    'missed_aspect',
    'wrong_field'
  )),
  feedback_text TEXT,

  -- The 3 reformulated interpretations Claude proposed. Stored as JSONB
  -- array: [{ label, semanticQuery, keywordQuery, rationale }, ...].
  claude_proposed_interpretations JSONB NOT NULL,

  -- The interpretation the user picked from the proposals. NULL when the
  -- user submitted feedback but never proceeded to generation. Same shape
  -- as a single proposal entry.
  chosen_interpretation JSONB,

  -- The new report this retry produced. NULL until generation kicks off.
  resulting_report_id UUID REFERENCES user_reports(id) ON DELETE SET NULL,

  -- The retry credit that funded this attempt. Created at refine step
  -- (auto-grant from failure OR self-serve grant within 14 days).
  retry_credit_id UUID REFERENCES report_credits(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_retry_feedback_user
  ON retry_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_retry_feedback_original_report
  ON retry_feedback (original_report_id);

ALTER TABLE retry_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own retry feedback" ON retry_feedback;
CREATE POLICY "Users read own retry feedback" ON retry_feedback
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service manages retry feedback" ON retry_feedback;
CREATE POLICY "Service manages retry feedback" ON retry_feedback
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.retry_feedback TO authenticated;
GRANT ALL ON public.retry_feedback TO service_role;

COMMENT ON TABLE retry_feedback IS
  'AI-assisted retry submissions. Captures user complaint, Claude proposals, chosen alternative, and the produced report. One row per retry submission.';

COMMENT ON COLUMN retry_feedback.claude_proposed_interpretations IS
  'JSONB array of {label, semanticQuery, keywordQuery, rationale} proposed by retryAssistantInterpretation in response to the user feedback.';

COMMENT ON COLUMN retry_feedback.resulting_report_id IS
  'The user_reports row this retry produced. NULL when feedback was submitted but generation never followed.';
