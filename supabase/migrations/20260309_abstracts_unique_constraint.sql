-- Add unique constraint on abstracts.application_id to enable upsert operations
-- This allows efficient FY2026 data loading via API

-- Duplicates exist from multiple ETL runs (~16K records, 8.8%)
-- All duplicates are identical content, so safe to remove
-- Keep the oldest record (earliest created_at) for each application_id

DELETE FROM abstracts a1
USING abstracts a2
WHERE a1.application_id = a2.application_id
  AND a1.created_at > a2.created_at;

-- Handle edge case: if created_at is identical, use id as tiebreaker
DELETE FROM abstracts a1
USING abstracts a2
WHERE a1.application_id = a2.application_id
  AND a1.created_at = a2.created_at
  AND a1.id > a2.id;

-- Add unique constraint
ALTER TABLE abstracts
ADD CONSTRAINT abstracts_application_id_unique UNIQUE (application_id);
