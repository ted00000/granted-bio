-- Persist the human-chosen search interpretation on the report row.
-- Required for Phase 3 refresh: the refresh endpoint needs the original
-- topic + interpretation to re-synthesize the same report against current
-- NIH data. Today the interpretation flows into generateTopicReport via
-- the picker but is only embedded in markdown_content text; structured
-- form lives nowhere we can query.
--
-- Backwards-compatible: column is nullable so pre-picker historical
-- reports stay as-is. Refresh on a report without an interpretation
-- falls back to topic-only generation, which uses the projects agent's
-- legacy buildSemanticQuery path.

ALTER TABLE user_reports
ADD COLUMN IF NOT EXISTS interpretation JSONB;

COMMENT ON COLUMN user_reports.interpretation IS
  'Human-chosen search interpretation used to generate this report. Shape: { semanticQuery, keywordQuery, label }. NULL for pre-picker historical reports.';
