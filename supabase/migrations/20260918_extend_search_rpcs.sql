-- Phase 1: extend search RPCs with filter parameters for every column
-- shipped during the 2026-09 audit cycle.
--
-- Backward-compatible — every new parameter defaults NULL, existing
-- callers see no behavior change. Signature changes require DROP first
-- because Postgres treats each parameter set as a distinct function.
--
-- New parameters on search_clinical_studies:
--   filter_primary_purposes         TEXT[]   — TREATMENT / DIAGNOSTIC / etc.
--   filter_lead_sponsor_classes     TEXT[]   — INDUSTRY / NIH / NETWORK / OTHER / ...
--   filter_condition_mesh           TEXT[]   — MeSH descriptors (@> semantics)
--   filter_intervention_mesh        TEXT[]   — MeSH descriptors (@> semantics)
--   filter_allocations              TEXT[]   — RANDOMIZED / NON_RANDOMIZED
--   filter_maskings                 TEXT[]   — NONE / SINGLE / DOUBLE / TRIPLE / QUADRUPLE
--   filter_has_dmc                  BOOLEAN
--   filter_is_fda_regulated_drug    BOOLEAN
--   filter_is_fda_regulated_device  BOOLEAN
--   filter_industry_collaborator    BOOLEAN — any collaborator with class INDUSTRY
--
-- New parameters on search_projects_filtered:
--   filter_admin_ics             TEXT[]  — NCI / NIAID / NIMH / ...
--   filter_foa_numbers           TEXT[]  — funding opportunity announcements
--   filter_spending_categories   TEXT[]  — NIH RCDC topic tags (@> semantics)
--   filter_min_direct_cost       NUMERIC
--
-- Return shape adds the new columns so callers can render / rank on them.

-- ============================================================
-- search_clinical_studies — extended
-- ============================================================

DROP FUNCTION IF EXISTS search_clinical_studies(VECTOR(1536), FLOAT, INT);
DROP FUNCTION IF EXISTS search_clinical_studies(
  VECTOR(1536), FLOAT, INT,
  TEXT[], TEXT[], TEXT[], TEXT[], TEXT[], TEXT[],
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
);

CREATE OR REPLACE FUNCTION search_clinical_studies(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 100,
  filter_primary_purposes TEXT[] DEFAULT NULL,
  filter_lead_sponsor_classes TEXT[] DEFAULT NULL,
  filter_condition_mesh TEXT[] DEFAULT NULL,
  filter_intervention_mesh TEXT[] DEFAULT NULL,
  filter_allocations TEXT[] DEFAULT NULL,
  filter_maskings TEXT[] DEFAULT NULL,
  filter_has_dmc BOOLEAN DEFAULT NULL,
  filter_is_fda_regulated_drug BOOLEAN DEFAULT NULL,
  filter_is_fda_regulated_device BOOLEAN DEFAULT NULL,
  filter_industry_collaborator BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  nct_id VARCHAR(20),
  study_title TEXT,
  study_status VARCHAR(50),
  is_diagnostic_trial BOOLEAN,
  is_therapeutic_trial BOOLEAN,
  project_number VARCHAR(50),
  -- New surfaces so callers can render / rerank on them.
  primary_purpose VARCHAR(50),
  lead_sponsor_class VARCHAR(50),
  condition_mesh TEXT[],
  intervention_mesh TEXT[],
  allocation VARCHAR(50),
  masking VARCHAR(50),
  has_dmc BOOLEAN,
  is_fda_regulated_drug BOOLEAN,
  is_fda_regulated_device BOOLEAN,
  similarity DOUBLE PRECISION
) AS $$
BEGIN
  SET LOCAL hnsw.ef_search = 200;

  RETURN QUERY
  SELECT
    cs.id,
    cs.nct_id,
    cs.study_title,
    cs.study_status,
    cs.is_diagnostic_trial,
    cs.is_therapeutic_trial,
    cs.project_number,
    cs.primary_purpose,
    cs.lead_sponsor_class,
    cs.condition_mesh,
    cs.intervention_mesh,
    cs.allocation,
    cs.masking,
    cs.has_dmc,
    cs.is_fda_regulated_drug,
    cs.is_fda_regulated_device,
    (1 - (cs.study_embedding <=> query_embedding))::DOUBLE PRECISION as similarity
  FROM clinical_studies cs
  WHERE cs.study_embedding IS NOT NULL
    AND cs.study_embedding <=> query_embedding < (1 - match_threshold)
    -- New filters — every NULL is a pass-through.
    AND (filter_primary_purposes IS NULL
         OR cs.primary_purpose = ANY(filter_primary_purposes))
    AND (filter_lead_sponsor_classes IS NULL
         OR cs.lead_sponsor_class = ANY(filter_lead_sponsor_classes))
    AND (filter_condition_mesh IS NULL
         OR cs.condition_mesh @> filter_condition_mesh)
    AND (filter_intervention_mesh IS NULL
         OR cs.intervention_mesh @> filter_intervention_mesh)
    AND (filter_allocations IS NULL
         OR cs.allocation = ANY(filter_allocations))
    AND (filter_maskings IS NULL
         OR cs.masking = ANY(filter_maskings))
    AND (filter_has_dmc IS NULL
         OR cs.has_dmc = filter_has_dmc)
    AND (filter_is_fda_regulated_drug IS NULL
         OR cs.is_fda_regulated_drug = filter_is_fda_regulated_drug)
    AND (filter_is_fda_regulated_device IS NULL
         OR cs.is_fda_regulated_device = filter_is_fda_regulated_device)
    -- Industry-collaborator cut. collaborators is a JSONB array of
    -- {name, class}; @> checks that at least one element matches.
    AND (filter_industry_collaborator IS NULL
         OR filter_industry_collaborator = FALSE
         OR cs.collaborators @> '[{"class": "INDUSTRY"}]'::jsonb)
  ORDER BY cs.study_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_clinical_studies IS
  'Semantic search over clinical trials with HNSW ef_search=200. Extended 2026-09-18 with 10 new filter parameters covering purpose, sponsor class, MeSH, rigor (allocation/masking/DMC), FDA jurisdiction, and industry-collaborator cut. All new params default NULL (pass-through). Response shape also extended to surface the new columns to callers.';


-- ============================================================
-- search_projects_filtered — extended
-- ============================================================

DROP FUNCTION IF EXISTS search_projects_filtered(
  VECTOR(1536), FLOAT, INT, INT,
  INT[], TEXT[], TEXT[], TEXT[], NUMERIC, NUMERIC
);
DROP FUNCTION IF EXISTS search_projects_filtered(
  VECTOR(1536), FLOAT, INT, INT,
  INT[], TEXT[], TEXT[], TEXT[], NUMERIC, NUMERIC,
  TEXT[], TEXT[], TEXT[], NUMERIC
);

CREATE OR REPLACE FUNCTION search_projects_filtered(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 50,
  min_biotools_confidence INT DEFAULT 0,
  filter_fiscal_years INT[] DEFAULT NULL,
  filter_categories TEXT[] DEFAULT NULL,
  filter_org_types TEXT[] DEFAULT NULL,
  filter_states TEXT[] DEFAULT NULL,
  filter_min_funding NUMERIC DEFAULT NULL,
  filter_max_funding NUMERIC DEFAULT NULL,
  -- New (2026-09-18) — RePORTER audit fields as filters.
  filter_admin_ics TEXT[] DEFAULT NULL,
  filter_foa_numbers TEXT[] DEFAULT NULL,
  filter_spending_categories TEXT[] DEFAULT NULL,
  filter_min_direct_cost NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  application_id VARCHAR(20),
  project_number VARCHAR(50),
  title TEXT,
  phr TEXT,
  org_name VARCHAR(500),
  org_type VARCHAR(50),
  org_city VARCHAR(100),
  org_state VARCHAR(10),
  total_cost NUMERIC,
  fiscal_year INT,
  funding_mechanism VARCHAR(100),
  primary_category bio_category,
  biotools_confidence DOUBLE PRECISION,
  biotools_reasoning TEXT,
  pi_names TEXT,
  is_supplement BOOLEAN,
  supplement_number VARCHAR(10),
  -- New surfaces so callers can render / rerank on them.
  contact_pi_name TEXT,
  admin_ic VARCHAR(20),
  foa_number VARCHAR(50),
  direct_cost_amt NUMERIC,
  indirect_cost_amt NUMERIC,
  study_section VARCHAR(300),
  spending_categories TEXT[],
  similarity FLOAT
) AS $$
BEGIN
  SET LOCAL hnsw.ef_search = 200;
  RETURN QUERY
  SELECT
    p.id, p.application_id, p.project_number, p.title, p.phr,
    p.org_name, p.org_type, p.org_city, p.org_state, p.total_cost,
    p.fiscal_year, p.funding_mechanism, p.primary_category,
    p.biotools_confidence, p.biotools_reasoning, p.pi_names,
    p.is_supplement, p.supplement_number,
    p.contact_pi_name, p.admin_ic, p.foa_number,
    p.direct_cost_amt, p.indirect_cost_amt,
    p.study_section, p.spending_categories,
    (1 - (p.abstract_embedding <=> query_embedding))::FLOAT as similarity
  FROM projects p
  WHERE p.abstract_embedding IS NOT NULL
    AND p.is_bio_related = true
    AND (1 - (p.abstract_embedding <=> query_embedding)) > match_threshold
    AND (min_biotools_confidence = 0
         OR p.biotools_confidence >= min_biotools_confidence)
    -- Existing filters
    AND (filter_fiscal_years IS NULL
         OR p.fiscal_year = ANY(filter_fiscal_years))
    AND (filter_categories IS NULL
         OR p.primary_category::TEXT = ANY(filter_categories))
    AND (filter_org_types IS NULL OR p.org_type = ANY(filter_org_types))
    AND (filter_states IS NULL OR p.org_state = ANY(filter_states))
    AND (filter_min_funding IS NULL OR p.total_cost >= filter_min_funding)
    AND (filter_max_funding IS NULL OR p.total_cost <= filter_max_funding)
    -- New filters
    AND (filter_admin_ics IS NULL OR p.admin_ic = ANY(filter_admin_ics))
    AND (filter_foa_numbers IS NULL
         OR p.foa_number = ANY(filter_foa_numbers))
    AND (filter_spending_categories IS NULL
         OR p.spending_categories @> filter_spending_categories)
    AND (filter_min_direct_cost IS NULL
         OR p.direct_cost_amt >= filter_min_direct_cost)
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_projects_filtered IS
  'Semantic search over projects with HNSW ef_search=200. Extended 2026-09-18 with 4 new filter parameters (admin_ic, FOA, spending categories, min_direct_cost) and 7 new returned columns from the RePORTER audit cycle. All new params default NULL (pass-through). Existing callers unaffected.';
