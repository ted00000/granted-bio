-- Improve vector search recall by increasing IVFFlat probes
-- The current setting of probes=10 with lists=100 only searches 10% of the index,
-- leading to missed results (e.g., "wheat genomics" query missing relevant projects)

-- Update search_projects function with higher probes for better recall
DROP FUNCTION IF EXISTS search_projects(vector, float, int, int);

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
  org_type VARCHAR(50),
  org_city VARCHAR(100),
  org_state VARCHAR(10),
  total_cost NUMERIC,
  fiscal_year INT,
  funding_mechanism VARCHAR(100),
  primary_category bio_category,
  biotools_confidence DOUBLE PRECISION,
  biotools_reasoning TEXT,
  pi_names TEXT,
  is_supplement BOOLEAN,
  supplement_number VARCHAR(10),
  similarity FLOAT
) AS $$
BEGIN
  -- Set higher probes for better recall (50 out of 100 lists = 50% coverage)
  -- This significantly improves recall at the cost of some query time
  SET LOCAL ivfflat.probes = 50;

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

-- Also update search_projects_filtered with higher probes
DROP FUNCTION IF EXISTS search_projects_filtered(vector, float, int, int, int[], text[], text[], text[], numeric, numeric);

CREATE OR REPLACE FUNCTION search_projects_filtered(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 50,
  min_biotools_confidence INT DEFAULT 0,
  filter_fiscal_years INT[] DEFAULT NULL,
  filter_categories TEXT[] DEFAULT NULL,
  filter_org_types TEXT[] DEFAULT NULL,
  filter_states TEXT[] DEFAULT NULL,
  filter_min_funding NUMERIC DEFAULT NULL,
  filter_max_funding NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  application_id VARCHAR(20),
  project_number VARCHAR(50),
  title TEXT,
  phr TEXT,
  org_name VARCHAR(500),
  org_type VARCHAR(50),
  org_city VARCHAR(100),
  org_state VARCHAR(10),
  total_cost NUMERIC,
  fiscal_year INT,
  funding_mechanism VARCHAR(100),
  primary_category bio_category,
  biotools_confidence DOUBLE PRECISION,
  biotools_reasoning TEXT,
  pi_names TEXT,
  is_supplement BOOLEAN,
  supplement_number VARCHAR(10),
  similarity FLOAT
) AS $$
BEGIN
  -- Set higher probes for better recall (50 out of 100 lists = 50% coverage)
  SET LOCAL ivfflat.probes = 50;

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
    AND (filter_fiscal_years IS NULL OR p.fiscal_year = ANY(filter_fiscal_years))
    AND (filter_categories IS NULL OR p.primary_category::TEXT = ANY(filter_categories))
    AND (filter_org_types IS NULL OR p.org_type = ANY(filter_org_types))
    AND (filter_states IS NULL OR p.org_state = ANY(filter_states))
    AND (filter_min_funding IS NULL OR p.total_cost >= filter_min_funding)
    AND (filter_max_funding IS NULL OR p.total_cost <= filter_max_funding)
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_projects IS 'Semantic search with improved recall (50% IVF probe coverage)';
COMMENT ON FUNCTION search_projects_filtered IS 'Filtered semantic search with improved recall (50% IVF probe coverage)';
