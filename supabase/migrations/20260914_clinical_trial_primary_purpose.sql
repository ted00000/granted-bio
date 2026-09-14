-- Capture ClinicalTrials.gov's `primaryPurpose` field on clinical_studies.
--
-- Why: the existing is_therapeutic_trial / is_diagnostic_trial booleans
-- are title-keyword heuristics with a default-to-therapeutic fallback.
-- CT.gov publishes the trial sponsor's own primary-purpose declaration
-- as a structured field in the study record; we already fetch and store
-- the full response in api_raw_data. Adopting the source-truth field
-- eliminates the inference layer and its bias.
--
-- Value set from CT.gov v2 API:
--   TREATMENT, PREVENTION, DIAGNOSTIC, SCREENING, SUPPORTIVE_CARE,
--   HEALTH_SERVICES_RESEARCH, BASIC_SCIENCE, DEVICE_FEASIBILITY, OTHER
-- Also legacy: EDUCATIONAL_COUNSELING_TRAINING (pre-v2 records only).
--
-- Not enum-constrained here — CT.gov can extend the set and we don't
-- want a migration break every time. Values are validated by the ETL
-- layer.

ALTER TABLE clinical_studies
  ADD COLUMN IF NOT EXISTS primary_purpose VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_clinical_studies_primary_purpose
  ON clinical_studies(primary_purpose)
  WHERE primary_purpose IS NOT NULL;

COMMENT ON COLUMN clinical_studies.primary_purpose IS
  'Source-truth trial purpose from ClinicalTrials.gov (protocolSection.designModule.designInfo.primaryPurpose). Values: TREATMENT, PREVENTION, DIAGNOSTIC, SCREENING, SUPPORTIVE_CARE, HEALTH_SERVICES_RESEARCH, BASIC_SCIENCE, DEVICE_FEASIBILITY, OTHER, and legacy EDUCATIONAL_COUNSELING_TRAINING. NULL when the source did not populate it or the row has not been enriched.';
