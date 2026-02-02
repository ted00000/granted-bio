-- =====================================================
-- DATABASE OPTIMIZATION MIGRATION
-- =====================================================
-- This migration adds indexes and optimizations based on
-- query pattern analysis of the granted.bio platform.
--
-- Key findings from audit:
-- 1. Vector search takes 1-1.5s (acceptable but improvable)
-- 2. Filter queries on fiscal_year, org_type, org_state take 200-650ms
-- 3. ILIKE searches on org_name, pi_names are slow
-- 4. Filters applied in JavaScript instead of SQL
-- =====================================================

-- =====================================================
-- PART 1: B-TREE INDEXES FOR COMMON FILTERS
-- =====================================================

-- fiscal_year: Heavily filtered (645ms → <50ms expected)
CREATE INDEX IF NOT EXISTS idx_projects_fiscal_year
ON projects(fiscal_year);

-- org_state: Common geographic filter
CREATE INDEX IF NOT EXISTS idx_projects_org_state
ON projects(org_state);

-- org_type: Filter by company/university/hospital
CREATE INDEX IF NOT EXISTS idx_projects_org_type
ON projects(org_type);

-- primary_category: Life science category filter
CREATE INDEX IF NOT EXISTS idx_projects_primary_category
ON projects(primary_category);

-- is_bio_related: Critical - search_projects filters on this
-- Partial index only on true values since we only query is_bio_related=true
CREATE INDEX IF NOT EXISTS idx_projects_bio_related
ON projects(id) WHERE is_bio_related = true;

-- total_cost: Funding amount range queries
CREATE INDEX IF NOT EXISTS idx_projects_total_cost
ON projects(total_cost);

-- funding_mechanism: SBIR/STTR filtering
CREATE INDEX IF NOT EXISTS idx_projects_funding_mechanism
ON projects(funding_mechanism);

-- application_id: Used for lookups (should already exist as primary/unique)
CREATE INDEX IF NOT EXISTS idx_projects_application_id
ON projects(application_id);

-- =====================================================
-- PART 2: COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- =====================================================

-- Common filter combination: bio_related + fiscal_year + org_state
CREATE INDEX IF NOT EXISTS idx_projects_bio_year_state
ON projects(fiscal_year, org_state)
WHERE is_bio_related = true;

-- Company search: bio_related + org_type + total_cost
CREATE INDEX IF NOT EXISTS idx_projects_bio_orgtype_cost
ON projects(org_type, total_cost DESC)
WHERE is_bio_related = true;

-- =====================================================
-- PART 3: GIN INDEXES FOR TEXT SEARCH
-- =====================================================

-- org_name: Used heavily in company profile lookups
-- GIN trigram index for fast ILIKE/pattern matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_projects_org_name_trgm
ON projects USING gin(org_name gin_trgm_ops);

-- pi_names: Used in PI profile lookups
CREATE INDEX IF NOT EXISTS idx_projects_pi_names_trgm
ON projects USING gin(pi_names gin_trgm_ops);

-- title: For keyword searches
CREATE INDEX IF NOT EXISTS idx_projects_title_trgm
ON projects USING gin(title gin_trgm_ops);

-- =====================================================
-- PART 4: FOREIGN KEY INDEXES FOR JOINS
-- =====================================================

-- project_number is used to join projects with patents, publications, studies
CREATE INDEX IF NOT EXISTS idx_projects_project_number
ON projects(project_number);

CREATE INDEX IF NOT EXISTS idx_patents_project_number
ON patents(project_number);

CREATE INDEX IF NOT EXISTS idx_publications_project_number
ON project_publications(project_number);

CREATE INDEX IF NOT EXISTS idx_clinical_studies_project_number
ON clinical_studies(project_number);

-- =====================================================
-- PART 5: OPTIMIZED SEARCH FUNCTION
-- =====================================================
-- Push filters to SQL instead of post-filtering in JavaScript

DROP FUNCTION IF EXISTS search_projects_filtered(vector, float, int, int, int[], text[], text[], text, numeric, numeric);

CREATE OR REPLACE FUNCTION search_projects_filtered(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 50,
  min_biotools_confidence INT DEFAULT 0,
  -- New filter parameters
  filter_fiscal_years INT[] DEFAULT NULL,
  filter_categories TEXT[] DEFAULT NULL,
  filter_org_types TEXT[] DEFAULT NULL,
  filter_state TEXT DEFAULT NULL,
  filter_min_funding NUMERIC DEFAULT NULL,
  filter_max_funding NUMERIC DEFAULT NULL
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
  similarity FLOAT
) AS $$
BEGIN
  -- Set higher probes for better recall with IVFFlat index
  SET LOCAL ivfflat.probes = 10;

  RETURN QUERY
  SELECT
    p.id,
    p.application_id,
    p.project_number,
    p.title,
    p.phr,
    p.org_name,
    p.org_type,
    p.org_city,
    p.org_state,
    p.total_cost,
    p.fiscal_year,
    p.funding_mechanism,
    p.primary_category,
    p.biotools_confidence,
    p.biotools_reasoning,
    p.pi_names,
    p.is_supplement,
    p.supplement_number,
    (1 - (p.abstract_embedding <=> query_embedding))::FLOAT as similarity
  FROM projects p
  WHERE p.abstract_embedding IS NOT NULL
    AND p.is_bio_related = true
    AND (1 - (p.abstract_embedding <=> query_embedding)) > match_threshold
    AND (min_biotools_confidence = 0 OR p.biotools_confidence >= min_biotools_confidence)
    -- Apply optional filters in SQL
    AND (filter_fiscal_years IS NULL OR p.fiscal_year = ANY(filter_fiscal_years))
    AND (filter_categories IS NULL OR p.primary_category::TEXT = ANY(filter_categories))
    AND (filter_org_types IS NULL OR p.org_type = ANY(filter_org_types))
    AND (filter_state IS NULL OR p.org_state = filter_state)
    AND (filter_min_funding IS NULL OR p.total_cost >= filter_min_funding)
    AND (filter_max_funding IS NULL OR p.total_cost <= filter_max_funding)
  ORDER BY p.abstract_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_projects_filtered IS 'Optimized semantic search with SQL-level filtering for better performance';

-- =====================================================
-- PART 6: ANALYZE TABLES FOR QUERY PLANNER
-- =====================================================

ANALYZE projects;
ANALYZE patents;
ANALYZE project_publications;
ANALYZE clinical_studies;
