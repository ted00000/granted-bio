-- Add embedding column to publications table for semantic search
ALTER TABLE publications ADD COLUMN IF NOT EXISTS publication_embedding VECTOR(1536);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_publications_embedding
  ON publications USING ivfflat (publication_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON COLUMN publications.publication_embedding IS 'Vector embedding of publication title (1536 dims, OpenAI text-embedding-3-small)';
