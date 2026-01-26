-- Clear all incorrectly formatted embeddings
-- These were stored as strings instead of proper VECTOR format
-- Must be run before restarting embedding generation

UPDATE projects
SET abstract_embedding = NULL
WHERE abstract_embedding IS NOT NULL;

-- Verify
-- SELECT COUNT(*) FROM projects WHERE abstract_embedding IS NOT NULL;
-- Should return 0
