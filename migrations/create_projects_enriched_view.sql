-- Migration: Create projects_enriched materialized view
-- This view pre-computes patent, publication, and clinical trial counts for each project

-- Drop if exists (in case of re-run)
DROP MATERIALIZED VIEW IF EXISTS biotools_high_confidence CASCADE;
DROP MATERIALIZED VIEW IF EXISTS projects_enriched CASCADE;

-- Create the enriched projects view
CREATE MATERIALIZED VIEW projects_enriched AS
SELECT
  p.*,

  -- Publication counts
  COALESCE(COUNT(DISTINCT pub.pmid), 0)::integer as publication_count,
  COALESCE(COUNT(DISTINCT CASE WHEN pub.is_methods_journal THEN pub.pmid END), 0)::integer as methods_journal_count,
  COALESCE(COUNT(DISTINCT CASE WHEN pub.is_therapeutic_journal THEN pub.pmid END), 0)::integer as therapeutic_journal_count,

  -- Patent counts
  COALESCE(COUNT(DISTINCT pat.patent_id), 0)::integer as patent_count,
  COALESCE(COUNT(DISTINCT CASE WHEN pat.is_device_patent THEN pat.patent_id END), 0)::integer as device_patent_count,
  COALESCE(COUNT(DISTINCT CASE WHEN pat.is_therapeutic_patent THEN pat.patent_id END), 0)::integer as therapeutic_patent_count,

  -- Clinical trial counts
  COALESCE(COUNT(DISTINCT cs.nct_id), 0)::integer as clinical_trial_count,
  COALESCE(COUNT(DISTINCT CASE WHEN cs.is_therapeutic_trial THEN cs.nct_id END), 0)::integer as therapeutic_trial_count,

  -- Computed signals
  CASE
    WHEN COUNT(DISTINCT pat.patent_id) > 0 AND COUNT(DISTINCT pub.pmid) > 0
    THEN CAST(COUNT(DISTINCT pat.patent_id) AS FLOAT) / COUNT(DISTINCT pub.pmid)
    ELSE 0
  END as patent_to_pub_ratio

FROM projects p
LEFT JOIN abstracts a ON p.application_id = a.application_id
LEFT JOIN project_publications pp ON p.project_number = pp.project_number
LEFT JOIN publications pub ON pp.pmid = pub.pmid
LEFT JOIN patents pat ON p.project_number = pat.project_number
LEFT JOIN clinical_studies cs ON p.project_number = cs.project_number
GROUP BY p.id;

-- Create indexes for efficient queries
CREATE INDEX idx_projects_enriched_app_id ON projects_enriched(application_id);
CREATE INDEX idx_projects_enriched_publication_count ON projects_enriched(publication_count);
CREATE INDEX idx_projects_enriched_patent_count ON projects_enriched(patent_count);
CREATE INDEX idx_projects_enriched_clinical_trial_count ON projects_enriched(clinical_trial_count);

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX idx_projects_enriched_id ON projects_enriched(id);

-- Optional: Create biotools high confidence view (depends on projects_enriched)
CREATE MATERIALIZED VIEW biotools_high_confidence AS
SELECT * FROM projects_enriched
WHERE biotools_confidence >= 60
  AND is_bio_related = true
ORDER BY biotools_confidence DESC;

CREATE UNIQUE INDEX idx_biotools_high_confidence_id ON biotools_high_confidence(id);

-- Function to refresh views (can be called periodically)
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY projects_enriched;
  REFRESH MATERIALIZED VIEW CONCURRENTLY biotools_high_confidence;
END;
$$ LANGUAGE plpgsql;
