-- Enrich clinical_studies table with data from ClinicalTrials.gov API
-- This enables internal trial detail pages with full trial information

-- Add new columns for enriched data
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS phase VARCHAR(50);
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS conditions TEXT[];
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS interventions JSONB;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS enrollment_count INT;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS lead_sponsor VARCHAR(500);
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS completion_date DATE;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS eligibility_criteria TEXT;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS study_type VARCHAR(50);
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS brief_summary TEXT;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS api_last_updated TIMESTAMPTZ;
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS api_raw_data JSONB;

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_clinical_studies_phase ON clinical_studies(phase);
CREATE INDEX IF NOT EXISTS idx_clinical_studies_study_type ON clinical_studies(study_type);
CREATE INDEX IF NOT EXISTS idx_clinical_studies_lead_sponsor ON clinical_studies(lead_sponsor);
CREATE INDEX IF NOT EXISTS idx_clinical_studies_start_date ON clinical_studies(start_date);
CREATE INDEX IF NOT EXISTS idx_clinical_studies_api_last_updated ON clinical_studies(api_last_updated);

-- GIN index for conditions array search
CREATE INDEX IF NOT EXISTS idx_clinical_studies_conditions ON clinical_studies USING GIN(conditions);

-- Comments
COMMENT ON COLUMN clinical_studies.phase IS 'Trial phase: PHASE1, PHASE2, PHASE3, PHASE4, NA, EARLY_PHASE1';
COMMENT ON COLUMN clinical_studies.conditions IS 'Array of conditions/diseases being studied';
COMMENT ON COLUMN clinical_studies.interventions IS 'JSON array of interventions: [{name, type, description}]';
COMMENT ON COLUMN clinical_studies.enrollment_count IS 'Target or actual enrollment number';
COMMENT ON COLUMN clinical_studies.lead_sponsor IS 'Organization leading the study';
COMMENT ON COLUMN clinical_studies.start_date IS 'Study start date';
COMMENT ON COLUMN clinical_studies.completion_date IS 'Primary completion date';
COMMENT ON COLUMN clinical_studies.eligibility_criteria IS 'Inclusion/exclusion criteria text';
COMMENT ON COLUMN clinical_studies.study_type IS 'INTERVENTIONAL, OBSERVATIONAL, EXPANDED_ACCESS';
COMMENT ON COLUMN clinical_studies.brief_summary IS 'Brief description of the study';
COMMENT ON COLUMN clinical_studies.api_last_updated IS 'When data was last fetched from ClinicalTrials.gov';
COMMENT ON COLUMN clinical_studies.api_raw_data IS 'Full API response for future use';

-- Update the search function to return enriched fields
DROP FUNCTION IF EXISTS search_clinical_studies(VECTOR(1536), FLOAT, INT);

CREATE OR REPLACE FUNCTION search_clinical_studies(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  nct_id VARCHAR(20),
  study_title TEXT,
  study_status VARCHAR(50),
  is_diagnostic_trial BOOLEAN,
  is_therapeutic_trial BOOLEAN,
  project_number VARCHAR(50),
  phase VARCHAR(50),
  enrollment_count INT,
  lead_sponsor VARCHAR(500),
  similarity DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id,
    cs.nct_id,
    cs.study_title,
    cs.study_status,
    cs.is_diagnostic_trial,
    cs.is_therapeutic_trial,
    cs.project_number,
    cs.phase,
    cs.enrollment_count,
    cs.lead_sponsor,
    (1 - (cs.study_embedding <=> query_embedding))::DOUBLE PRECISION as similarity
  FROM clinical_studies cs
  WHERE cs.study_embedding IS NOT NULL
    AND 1 - (cs.study_embedding <=> query_embedding) > match_threshold
  ORDER BY cs.study_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
