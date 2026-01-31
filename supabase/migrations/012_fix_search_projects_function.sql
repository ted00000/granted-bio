-- Create search_projects function that matches the API expectations
-- This replaces search_projects_by_embedding with the correct name and parameters

DROP FUNCTION IF EXISTS search_projects;
DROP FUNCTION IF EXISTS search_projects_by_embedding;

CREATE OR REPLACE FUNCTION search_projects(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 50,
  min_biotools_confidence INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  application_id VARCHAR(20),
  project_number VARCHAR(50),
  title TEXT,
  phr TEXT,
  org_name VARCHAR(500),
  org_type VARCHAR(100),
  org_city VARCHAR(100),
  org_state VARCHAR(50),
  total_cost NUMERIC(12,2),
  fiscal_year INT,
  funding_mechanism VARCHAR(50),
  primary_category TEXT,
  biotools_confidence INT,
  biotools_reasoning TEXT,
  pi_names TEXT,
  is_supplement BOOLEAN,
  supplement_number VARCHAR(20),
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.application_id,
    p.project_number,
    p.title,
    p.phr,
    p.org_name,
    p.org_type,
    p.org_city,
    p.org_state,
    p.total_cost,
    p.fiscal_year,
    p.funding_mechanism,
    p.primary_category,
    p.biotools_confidence,
    p.biotools_reasoning,
    p.pi_names,
    p.is_supplement,
    p.supplement_number,
    (1 - (p.abstract_embedding <=> query_embedding))::FLOAT as similarity
  FROM projects p
  WHERE p.abstract_embedding IS NOT NULL
    AND p.is_bio_related = true
    AND (1 - (p.abstract_embedding <=> query_embedding)) > match_threshold
    AND (min_biotools_confidence = 0 OR p.biotools_confidence >= min_biotools_confidence)
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_projects IS 'Semantic search for projects using vector similarity on abstract_embedding';
