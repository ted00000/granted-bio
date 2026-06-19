-- Drop the orphaned projects_enriched materialized view, then drop the two
-- NULL-everywhere embedding columns from projects.
--
-- ============================================================================
-- Part 1: the projects_enriched materialized view
-- ============================================================================
--
-- Migration 004_drop_unused_views.sql dropped this view in an earlier cleanup.
-- It was recreated at some point via Supabase Studio without a migration
-- record. The current live definition (captured 2026-06-18 from pg_matviews)
-- is a passthrough of the projects table — every column enumerated explicitly
-- — with three columns hardcoded to 0:
--   * publication_count = 0
--   * patent_count = 0
--   * clinical_trial_count = 0
-- The schema doc's join-and-aggregate version was never implemented.
--
-- No code path actually queries the view. Two references exist in
-- src/lib/chat/tools.ts (lines 622 and 1128) but they are comments only;
-- there are zero `.from('projects_enriched')` calls anywhere in src/.
-- The misleading comments are removed in the same commit as this migration.
--
-- biotools_high_confidence (the other view defined in the schema doc) was
-- not recreated and does not currently exist in the live DB.
--
-- The etl/load_to_supabase.py:361 call to refresh_materialized_views()
-- already swallows failures via try/except, so dropping the view won't
-- break the ETL pipeline.
--
-- ============================================================================
-- Part 2: the embedding columns
-- ============================================================================
--
-- title_embedding and phr_embedding have been NULL on 100% of 154,159
-- project rows since launch (verified 2026-06-18 via
-- scripts/check-embedding-coverage.ts). The embedding pipeline at
-- etl/generate_embeddings_batched.py:108 concatenates
-- title + phr + terms + abstract into one blended vector stored in
-- abstract_embedding, so the title and phr signal is already captured.
-- Dropping these columns loses zero semantic content.
--
-- Now that projects_enriched is gone (and was the only object depending
-- on them), the column drops can proceed.

DROP MATERIALIZED VIEW IF EXISTS public.projects_enriched;

ALTER TABLE public.projects DROP COLUMN IF EXISTS title_embedding;
ALTER TABLE public.projects DROP COLUMN IF EXISTS phr_embedding;
