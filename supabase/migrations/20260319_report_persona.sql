-- Add persona-aware fields to user_reports
-- Supports researcher vs investor personas with distinct report structures

-- Add persona column (defaults to 'researcher' for backward compatibility)
ALTER TABLE user_reports
ADD COLUMN IF NOT EXISTS persona VARCHAR(20) DEFAULT 'researcher';

-- Add signals analysis (persona-specific interpretation layer)
ALTER TABLE user_reports
ADD COLUMN IF NOT EXISTS signals_analysis JSONB;

-- Add curated publications (3-5 must-read papers with explanations)
ALTER TABLE user_reports
ADD COLUMN IF NOT EXISTS curated_publications JSONB;

-- Comment on new columns
COMMENT ON COLUMN user_reports.persona IS 'Report persona: researcher (competitive intel) or investor (risk/opportunity)';
COMMENT ON COLUMN user_reports.signals_analysis IS 'Persona-specific signals: positioning, TRL, IP concentration, etc.';
COMMENT ON COLUMN user_reports.curated_publications IS 'Curated list of 3-5 must-read publications with significance explanations';
