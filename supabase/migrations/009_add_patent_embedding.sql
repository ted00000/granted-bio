-- Add embedding column to patents table for semantic patent search
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_embedding VECTOR(1536);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_patents_embedding
  ON patents USING ivfflat (patent_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON COLUMN patents.patent_embedding IS 'Vector embedding of patent title (1536 dims, OpenAI text-embedding-3-small)';
