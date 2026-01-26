-- Fix type mismatch in search function
DROP FUNCTION IF EXISTS search_projects_by_embedding;

CREATE OR REPLACE FUNCTION search_projects_by_embedding(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.0,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  application_id VARCHAR(20),
  title TEXT,
  org_name VARCHAR(500),
  fiscal_year INT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.application_id,
    p.title,
    p.org_name,
    p.fiscal_year,
    1 - (p.abstract_embedding <=> query_embedding) as similarity
  FROM projects p
  WHERE p.abstract_embedding IS NOT NULL
    AND 1 - (p.abstract_embedding <=> query_embedding) > match_threshold
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
