-- Lazy-on-view Haiku classifier version tracking (2026-09-21).
--
-- Existing ETL sets three flag booleans per patent (is_device_patent,
-- is_therapeutic_patent, is_method_patent) and three per publication
-- (is_methods_journal, is_therapeutic_journal, is_computational_journal).
-- Both are keyword-based:
--   * Patent flags: any(keyword in patent_title) — misses chemistry-heavy
--     titles ("Radiolabeled ligand conjugates for targeted alpha therapy")
--     that don't include generic classification keywords.
--   * Publication journal flags: any(keyword in journal_abbr/title) —
--     inherently coarse; "Nature" publishes methods, therapeutic AND
--     computational articles indistinguishably.
--
-- The Haiku classifier reads title + abstract and reassigns the flags at
-- article/patent level. It runs lazy-on-view: first time a project or
-- company detail page loads, /api/company/[id] finds any surfaced items
-- with flags_classifier_version < CURRENT_CLASSIFIER_VERSION, fires
-- Haiku, updates the rows in place, and increments the version so
-- subsequent views skip the classifier.
--
-- Same pattern as USPTO ODP lazy hydration (project_patent_enrichment
-- memory). Cost pattern: ~$0.005-0.02 per uncached page load, then free
-- forever for those items. High-traffic projects backfill first; the
-- long tail never pays unless someone actually reads it.

ALTER TABLE patents
  ADD COLUMN IF NOT EXISTS flags_classifier_version SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS flags_classifier_version SMALLINT NOT NULL DEFAULT 0;

-- Index only where the classifier hasn't run yet — the surface size of
-- "needs classification" queries is small once backfill matures, and a
-- full index on version=0 would be dead weight after every item has
-- been classified. Partial index keeps the pruning cheap.
CREATE INDEX IF NOT EXISTS idx_patents_flags_unclassified
  ON patents (patent_id)
  WHERE flags_classifier_version = 0;

CREATE INDEX IF NOT EXISTS idx_publications_flags_unclassified
  ON publications (pmid)
  WHERE flags_classifier_version = 0;

COMMENT ON COLUMN patents.flags_classifier_version IS
  '0 = classified by legacy keyword ETL (etl/process_patents.py); '
  '1+ = classified by Haiku (src/lib/classifiers/lazy-flags.ts). '
  'Bump the CURRENT constant to invalidate and re-run all items.';

COMMENT ON COLUMN publications.flags_classifier_version IS
  '0 = classified by legacy journal-name keyword ETL '
  '(etl/process_publications.py:classify_journal); 1+ = Haiku article-'
  'level classifier.';
