-- Migration: Add search_patents RPC function for vector similarity search
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION search_patents(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  patent_id VARCHAR(50),
  patent_title TEXT,
  project_number VARCHAR(50),
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.patent_id,
    p.patent_title,
    p.project_number,
    1 - (p.patent_embedding <=> query_embedding) as similarity
  FROM patents p
  WHERE
    p.patent_embedding IS NOT NULL
    AND 1 - (p.patent_embedding <=> query_embedding) > match_threshold
  ORDER BY p.patent_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
