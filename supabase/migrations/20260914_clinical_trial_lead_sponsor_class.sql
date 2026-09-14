-- Capture CT.gov's sponsor classification (INDUSTRY, NIH, OTHER_GOV,
-- NETWORK, INDIV, OTHER, etc.) on clinical_studies.
--
-- Why: we already store the lead sponsor's NAME as free text. To
-- answer "is this trial industry-sponsored or academic?" today, code
-- has to guess from the name string. CT.gov publishes the sponsor's
-- class as a structured enum on the same record (fetched and stored
-- in api_raw_data). Extracting it unlocks direct GTM filters like
-- "industry-sponsored trials at NIH-funded orgs".
--
-- CT.gov v2 value set (observed in production api_raw_data):
--   INDUSTRY, NIH, OTHER_GOV, NETWORK, INDIV, OTHER, FED, AMBIG, UNKNOWN
-- Not enum-constrained here — CT.gov extends this set periodically.
-- Values validated by the ETL.

ALTER TABLE clinical_studies
  ADD COLUMN IF NOT EXISTS lead_sponsor_class VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_clinical_studies_lead_sponsor_class
  ON clinical_studies(lead_sponsor_class)
  WHERE lead_sponsor_class IS NOT NULL;

COMMENT ON COLUMN clinical_studies.lead_sponsor_class IS
  'Sponsor classification from ClinicalTrials.gov (protocolSection.sponsorCollaboratorsModule.leadSponsor.class). Values: INDUSTRY, NIH, OTHER_GOV, NETWORK, INDIV, OTHER, FED, AMBIG, UNKNOWN. NULL when the source did not populate it or the row has not been enriched.';
