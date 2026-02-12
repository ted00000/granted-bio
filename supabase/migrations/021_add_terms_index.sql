-- Add GIN trigram index on terms column for fast ILIKE searches
-- This fixes timeout issues when searching the terms field in keyword_search

-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index on terms column for fast pattern matching
CREATE INDEX IF NOT EXISTS idx_projects_terms_gin
ON projects
USING gin (terms gin_trgm_ops);

-- Also add index on abstract_text for faster keyword searches
CREATE INDEX IF NOT EXISTS idx_abstracts_text_gin
ON abstracts
USING gin (abstract_text gin_trgm_ops);

COMMENT ON INDEX idx_projects_terms_gin IS 'GIN trigram index for fast ILIKE searches on project terms';
COMMENT ON INDEX idx_abstracts_text_gin IS 'GIN trigram index for fast ILIKE searches on abstract text';
