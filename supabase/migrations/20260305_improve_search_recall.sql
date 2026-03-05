-- Improve vector search recall by setting IVFFlat probes
-- This ensures consistent recall across all search functions

-- Update search_clinical_studies with higher probes
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
  -- Set higher probes for better recall (50 out of 100 lists = 50% coverage)
  SET LOCAL ivfflat.probes = 50;

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
    AND 1 - (cs.study_embedding <=> query_embedding) > match_threshold
  ORDER BY cs.study_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_clinical_studies IS 'Semantic search with improved recall (50% IVF probe coverage)';
