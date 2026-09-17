-- Trial-quality pack for clinical_studies.
--
-- Eleven columns extracted from stored api_raw_data. All source-truth
-- from ClinicalTrials.gov's protocol modules. Same pattern as the
-- primary_purpose / lead_sponsor_class / MeSH ships — the raw is
-- already stored on 91%+ of rows, so backfill is free.
--
-- Grouped by protocol module for legibility:
--
-- designModule.designInfo
--   allocation         — RANDOMIZED / NON_RANDOMIZED / NA
--   intervention_model — SINGLE_GROUP / PARALLEL / CROSSOVER / FACTORIAL / SEQUENTIAL
--   masking            — NONE / SINGLE / DOUBLE / TRIPLE / QUADRUPLE
--
-- statusModule
--   why_stopped        — free text; populated when a trial terminated early
--
-- oversightModule
--   is_fda_regulated_drug
--   is_fda_regulated_device
--   has_dmc            — data monitoring committee flag
--
-- sponsorCollaboratorsModule
--   collaborators      — JSONB array [{name, class}]
--                        Class enum same as lead_sponsor_class.
--                        Unlocks "academic-led trial with industry collaborator"
--                        cross-cut.
--
-- contactsLocationsModule
--   overall_officials  — JSONB array [{name, role, affiliation}]
--                        Source-truth PI attribution for trials.
--                        Roles: STUDY_CHAIR / STUDY_DIRECTOR /
--                        PRINCIPAL_INVESTIGATOR / SUB_INVESTIGATOR
--
-- outcomesModule
--   primary_outcomes   — JSONB array [{measure, time_frame, description}]
--   secondary_outcomes — JSONB array [{measure, time_frame, description}]
--
-- Indexes: scalar columns get partial B-tree; collaborators gets GIN
-- so filter queries like "trials with an INDUSTRY collaborator" work.

ALTER TABLE clinical_studies
  ADD COLUMN IF NOT EXISTS allocation VARCHAR(50),
  ADD COLUMN IF NOT EXISTS intervention_model VARCHAR(50),
  ADD COLUMN IF NOT EXISTS masking VARCHAR(50),
  ADD COLUMN IF NOT EXISTS why_stopped TEXT,
  ADD COLUMN IF NOT EXISTS is_fda_regulated_drug BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_fda_regulated_device BOOLEAN,
  ADD COLUMN IF NOT EXISTS has_dmc BOOLEAN,
  ADD COLUMN IF NOT EXISTS collaborators JSONB,
  ADD COLUMN IF NOT EXISTS overall_officials JSONB,
  ADD COLUMN IF NOT EXISTS primary_outcomes JSONB,
  ADD COLUMN IF NOT EXISTS secondary_outcomes JSONB;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_allocation
  ON clinical_studies(allocation) WHERE allocation IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_intervention_model
  ON clinical_studies(intervention_model) WHERE intervention_model IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_masking
  ON clinical_studies(masking) WHERE masking IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_fda_drug
  ON clinical_studies(is_fda_regulated_drug) WHERE is_fda_regulated_drug = TRUE;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_fda_device
  ON clinical_studies(is_fda_regulated_device) WHERE is_fda_regulated_device = TRUE;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_why_stopped
  ON clinical_studies(id) WHERE why_stopped IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_studies_collaborators_gin
  ON clinical_studies USING GIN (collaborators);

COMMENT ON COLUMN clinical_studies.allocation IS
  'Randomization strategy from designModule.designInfo.allocation. Values: RANDOMIZED, NON_RANDOMIZED, NA. Rigor signal.';
COMMENT ON COLUMN clinical_studies.intervention_model IS
  'Trial design shape from designModule.designInfo.interventionModel. Values: SINGLE_GROUP, PARALLEL, CROSSOVER, FACTORIAL, SEQUENTIAL.';
COMMENT ON COLUMN clinical_studies.masking IS
  'Blinding structure from designModule.designInfo.maskingInfo.masking. Values: NONE, SINGLE, DOUBLE, TRIPLE, QUADRUPLE.';
COMMENT ON COLUMN clinical_studies.why_stopped IS
  'Free-text termination reason from statusModule.whyStopped. Present only on trials that stopped early.';
COMMENT ON COLUMN clinical_studies.is_fda_regulated_drug IS
  'FDA jurisdiction flag from oversightModule.isFdaRegulatedDrug.';
COMMENT ON COLUMN clinical_studies.is_fda_regulated_device IS
  'FDA jurisdiction flag from oversightModule.isFdaRegulatedDevice.';
COMMENT ON COLUMN clinical_studies.has_dmc IS
  'Data monitoring committee present from oversightModule.oversightHasDmc.';
COMMENT ON COLUMN clinical_studies.collaborators IS
  'JSONB array [{name, class}] from sponsorCollaboratorsModule.collaborators. Unlocks industry-collaborator queries even when lead_sponsor_class is academic.';
COMMENT ON COLUMN clinical_studies.overall_officials IS
  'JSONB array [{name, role, affiliation}] from contactsLocationsModule.overallOfficials. Source-truth PI attribution for trials, including role (STUDY_CHAIR / STUDY_DIRECTOR / PRINCIPAL_INVESTIGATOR / SUB_INVESTIGATOR) — fixes the trial-side PI ambiguity that pi_names on projects still has.';
COMMENT ON COLUMN clinical_studies.primary_outcomes IS
  'JSONB array [{measure, time_frame, description}] from outcomesModule.primaryOutcomes. What the trial actually measures — endpoint sophistication signal.';
COMMENT ON COLUMN clinical_studies.secondary_outcomes IS
  'JSONB array [{measure, time_frame, description}] from outcomesModule.secondaryOutcomes.';
