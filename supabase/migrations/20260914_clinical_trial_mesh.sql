-- Capture ClinicalTrials.gov MeSH descriptor tags on clinical_studies.
--
-- CT.gov's derivedSection.conditionBrowseModule and interventionBrowseModule
-- auto-map each trial's free-text conditions and interventions to NIH's
-- MeSH controlled vocabulary. These are the canonical topic tags used
-- across all NIH datasets (PubMed uses the same vocabulary), and they
-- offer materially better semantic recall than the free-text conditions
-- field we've been surfacing.
--
-- Two columns, both TEXT[]:
--   condition_mesh   — what the trial is about (disease/condition)
--   intervention_mesh — what the trial uses (drug, device, procedure)
--
-- We store just the term text, not the full {id, term} objects. IDs
-- are derivable from api_raw_data if we ever need hierarchical lookup
-- via MeSH's tree structure.
--
-- GIN indexes on both to enable fast contains-any / contains-all
-- filters like `condition_mesh @> ARRAY['Neoplasms']`.

ALTER TABLE clinical_studies
  ADD COLUMN IF NOT EXISTS condition_mesh TEXT[],
  ADD COLUMN IF NOT EXISTS intervention_mesh TEXT[];

CREATE INDEX IF NOT EXISTS idx_clinical_studies_condition_mesh_gin
  ON clinical_studies USING GIN (condition_mesh);

CREATE INDEX IF NOT EXISTS idx_clinical_studies_intervention_mesh_gin
  ON clinical_studies USING GIN (intervention_mesh);

COMMENT ON COLUMN clinical_studies.condition_mesh IS
  'MeSH descriptor terms derived from the trial''s conditions. Source: derivedSection.conditionBrowseModule.meshes[].term. Order preserves CT.gov''s emission order (typically broader-to-narrower). NULL when the trial has no derived MeSH — most-often on very new or observational trials CT.gov has not yet indexed.';

COMMENT ON COLUMN clinical_studies.intervention_mesh IS
  'MeSH descriptor terms derived from the trial''s interventions. Source: derivedSection.interventionBrowseModule.meshes[].term. NULL when interventions are absent or not MeSH-mapped (common on non-interventional trials).';
