-- Migrate clinical_studies.study_embedding from ivfflat to HNSW.
--
-- Background:
--   - projects.abstract_embedding has been on HNSW since 20260305 (the
--     fix_ivfflat_recall migration). search_projects uses
--     SET LOCAL hnsw.ef_search = 200 for high-recall queries.
--   - clinical_studies stayed on ivfflat (lists=100) from the original
--     011_add_clinical_study_embedding.sql.
--   - Under production load the ivfflat scan for 150 nearest neighbors
--     against 38K rows × 1536 dims periodically blows past the Supabase
--     service-role 8s statement timeout. We caught one such failure
--     in Phase 2's diagnostic ledger (path2Status: rpc_error,
--     path2ErrorMessage: "canceling statement due to statement timeout").
--   - HNSW gives near-perfect recall at default params and is dramatically
--     faster on this query pattern. Eliminates the timeout class entirely
--     rather than patching around it with retry-on-fail.
--
-- This migration:
--   1. Drops the ivfflat index on clinical_studies.study_embedding
--   2. Creates an HNSW index with vector_cosine_ops (defaults: m=16,
--      ef_construction=64 — good baseline for OpenAI text-embedding-3-small)
--   3. Updates search_clinical_studies to:
--        - SET LOCAL hnsw.ef_search = 200 (matches projects search)
--        - Use the distance operator directly in WHERE for cleanest
--          planner behavior and full index usage
--
-- Build time on 38K rows × 1536 dims with default HNSW params is
-- typically 1-3 minutes. During the build, queries against the
-- clinical_studies table fall back to sequential scans (still functional,
-- just slower). Run during a low-traffic window if possible — the
-- production trials agent has a retry-with-degraded-match_count path
-- (committed earlier as defense in depth) so a slow window won't break
-- the report flow.

DROP INDEX IF EXISTS idx_clinical_studies_embedding;

CREATE INDEX idx_clinical_studies_embedding_hnsw
  ON clinical_studies USING hnsw (study_embedding vector_cosine_ops);

COMMENT ON INDEX idx_clinical_studies_embedding_hnsw IS
  'HNSW index for semantic search over clinical-trial titles. Replaces the prior ivfflat (lists=100) index from 011_add_clinical_study_embedding.sql. ef_search is tuned per-query inside search_clinical_studies.';

-- Update the RPC to:
--   1. SET LOCAL hnsw.ef_search = 200 for high recall (matches search_projects).
--   2. Use the distance operator directly in WHERE so the planner can use
--      the index for both the ORDER BY and the threshold filter.
--   3. Return the same shape as before — no caller changes required.
DROP FUNCTION IF EXISTS search_clinical_studies(VECTOR(1536), FLOAT, INT);

CREATE OR REPLACE FUNCTION search_clinical_studies(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  nct_id VARCHAR(20),
  study_title TEXT,
  study_status VARCHAR(50),
  is_diagnostic_trial BOOLEAN,
  is_therapeutic_trial BOOLEAN,
  project_number VARCHAR(50),
  similarity DOUBLE PRECISION
) AS $$
BEGIN
  -- HNSW ef_search controls recall at query time; higher = more accurate
  -- nearest-neighbor search at a small latency cost. 200 matches the
  -- search_projects setting used for project semantic search.
  SET LOCAL hnsw.ef_search = 200;

  RETURN QUERY
  SELECT
    cs.id,
    cs.nct_id,
    cs.study_title,
    cs.study_status,
    cs.is_diagnostic_trial,
    cs.is_therapeutic_trial,
    cs.project_number,
    (1 - (cs.study_embedding <=> query_embedding))::DOUBLE PRECISION as similarity
  FROM clinical_studies cs
  WHERE cs.study_embedding IS NOT NULL
    -- Equivalent to "1 - distance > match_threshold" but expressed against
    -- the distance operator directly so the index can be used for the
    -- threshold filter as well as the ORDER BY.
    AND cs.study_embedding <=> query_embedding < (1 - match_threshold)
  ORDER BY cs.study_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
