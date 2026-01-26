-- Create a function to properly update embeddings with correct VECTOR type
CREATE OR REPLACE FUNCTION update_project_embedding(
  p_application_id TEXT,
  p_embedding FLOAT[]
)
RETURNS VOID AS $$
BEGIN
  UPDATE projects
  SET abstract_embedding = p_embedding::vector(1536)
  WHERE application_id = p_application_id;
END;
$$ LANGUAGE plpgsql;
