-- Add embedding column to clinical_studies table for semantic search
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS study_embedding VECTOR(1536);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_clinical_studies_embedding
  ON clinical_studies USING ivfflat (study_embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON COLUMN clinical_studies.study_embedding IS 'Vector embedding of study title (1536 dims, OpenAI text-embedding-3-small)';
