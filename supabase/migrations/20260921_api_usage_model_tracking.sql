-- Per-model tracking in api_usage (2026-09-21).
--
-- Existing api_usage row: input_tokens + output_tokens + cache_read_tokens
-- + cache_write_tokens + cost_cents, but cost was always calculated at
-- Sonnet rates ($3/M in, $15/M out) regardless of which model actually
-- ran. Now that the reports pipeline mixes Sonnet (synthesis), Haiku
-- (White Space + lazy-flag classifiers), and Opus (audit agent), the
-- single-row-per-report shape was undercounting Opus and overcounting
-- Haiku by 3-5×. Anthropic's own console reports per-model split, so
-- api_usage now matches: one row per model per report / per chat call.
--
-- The `model` column defaults to 'claude-sonnet-4-6' for backward
-- compat with pre-ship rows (they were all Sonnet by construction —
-- the pipeline didn't use Haiku or Opus before 2026-09-14). New rows
-- MUST set model explicitly via the logApiUsage caller.
--
-- No values-migration needed on existing rows: pre-ship rows correctly
-- reflect Sonnet-priced totals, so leaving them at the default is
-- fine.

ALTER TABLE api_usage
  ADD COLUMN IF NOT EXISTS model VARCHAR(50) NOT NULL DEFAULT 'claude-sonnet-4-6';

-- Also allow 'lazy_classifier' endpoint. The existing CHECK constraint
-- (if any) allowed only 'chat' and 'report'; broaden to include the
-- new endpoint before wiring lazy-flags.ts to log rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'api_usage_endpoint_check'
      AND conrelid = 'api_usage'::regclass
  ) THEN
    ALTER TABLE api_usage DROP CONSTRAINT api_usage_endpoint_check;
  END IF;
END $$;

ALTER TABLE api_usage
  ADD CONSTRAINT api_usage_endpoint_check
  CHECK (endpoint IN ('chat', 'report', 'lazy_classifier'));

-- Small partial index for the "recent per-model spend" question we're
-- likely to ask often (dashboard, monthly cap enforcement, etc.).
CREATE INDEX IF NOT EXISTS idx_api_usage_model_recent
  ON api_usage (model, created_at DESC);

COMMENT ON COLUMN api_usage.model IS
  'Anthropic model ID that generated this row. Priced per-model in '
  'src/lib/billing/usage.ts::PRICING_BY_MODEL. One row per (report, '
  'model) — a report that fires Sonnet synthesis + Haiku classifier + '
  'Opus audit lands three rows in this table.';
