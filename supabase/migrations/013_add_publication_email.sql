-- Add pi_email column to publications table for contact information
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pi_email VARCHAR(255);

-- Create index for email lookups
CREATE INDEX IF NOT EXISTS idx_publications_email
  ON publications (pi_email)
  WHERE pi_email IS NOT NULL AND pi_email != '';

COMMENT ON COLUMN publications.pi_email IS 'Email address extracted from affiliation field';
