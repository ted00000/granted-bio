-- Persist the human-chosen interpretation on report_purchases.
--
-- The interpretation (semanticQuery + keywordQuery + label) was
-- previously stored only on the Stripe session metadata, JSON-
-- stringified and `.slice(0, 500)`-truncated to fit Stripe's
-- 500-char-per-value cap. Broad-scope interpretations routinely
-- exceed 500 chars; truncation produced malformed JSON; the webhook
-- silently fell back to the legacy auto-rewrite path, scoring the
-- report against a different query than what the user picked and
-- paid for.
--
-- Solution: keep the interpretation on the purchase row itself, in
-- full, no truncation. The webhook reads it from here (alongside
-- topic / persona, which already live on the row). Stripe metadata
-- carries only what the recovery cron strictly needs (userId, topic,
-- persona, dataLimited) as a fallback for the rare case where the
-- purchase row insert fails after the Stripe session was created.

ALTER TABLE report_purchases
  ADD COLUMN IF NOT EXISTS interpretation JSONB;

COMMENT ON COLUMN report_purchases.interpretation IS
  'The {semanticQuery, keywordQuery, label} chosen at checkout time. Source of truth — webhook reads from here, not from Stripe metadata.';
