-- 02: Database Schema for granted.bio
-- PostgreSQL 15 + pgvector extension
-- Target: Supabase
-- Last Updated: January 25, 2026

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Enable vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE funding_agency AS ENUM ('NIH', 'NSF', 'DOD', 'DOE', 'OTHER');
CREATE TYPE bio_category AS ENUM ('biotools', 'diagnostics', 'therapeutics', 'medical_device', 'digital_health', 'other');
CREATE TYPE confidence_level AS ENUM ('HIGH', 'MODERATE', 'LOW');
CREATE TYPE job_status AS ENUM ('queued', 'processing', 'completed', 'failed');

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROJECTS (Core Grant Data)
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identifiers
  application_id VARCHAR(20) UNIQUE NOT NULL,
  project_number VARCHAR(50) UNIQUE NOT NULL,
  full_project_num VARCHAR(100),
  
  -- Project Details
  activity_code VARCHAR(10),
  funding_mechanism VARCHAR(100),
  title TEXT NOT NULL,
  terms TEXT, -- Semicolon-separated keywords
  phr TEXT, -- Public Health Relevance
  
  -- Organization
  org_name VARCHAR(500),
  org_type VARCHAR(50), -- 'company', 'university', 'hospital', etc.
  org_city VARCHAR(100),
  org_state VARCHAR(10),
  org_country VARCHAR(50),
  org_zip VARCHAR(20),
  
  -- Funding
  total_cost DECIMAL(12,2),
  award_date DATE,
  project_start DATE,
  project_end DATE,
  fiscal_year INT,
  
  -- PIs
  pi_names TEXT, -- Comma-separated
  
  -- Agency
  funding_agency funding_agency DEFAULT 'NIH',
  
  -- Bio Boundary
  is_bio_related BOOLEAN DEFAULT true,
  
  -- Multi-Category Classification
  primary_category bio_category,
  primary_category_confidence FLOAT CHECK (primary_category_confidence >= 0 AND primary_category_confidence <= 100),
  
  secondary_categories JSONB, -- {"diagnostics": 45, "therapeutics": 30}
  
  -- Biotools Specific (MVP Focus)
  biotools_confidence FLOAT CHECK (biotools_confidence >= 0 AND biotools_confidence <= 100),
  biotools_subcategory VARCHAR(50), -- 'research_instruments', 'assays_reagents', etc.
  biotools_signals JSONB, -- Array of signal objects with tier, source, signal, weight
  biotools_reasoning TEXT,
  
  -- Future Category Fields
  diagnostics_confidence FLOAT,
  therapeutics_confidence FLOAT,
  medical_device_confidence FLOAT,
  digital_health_confidence FLOAT,
  
  -- Embeddings (1536 dimensions - OpenAI text-embedding-3-small)
  title_embedding VECTOR(1536),
  phr_embedding VECTOR(1536),
  abstract_embedding VECTOR(1536),
  
  -- Metadata
  import_id UUID, -- References data_imports table
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_projects_funding_agency ON projects(funding_agency);
CREATE INDEX idx_projects_primary_category ON projects(primary_category);
CREATE INDEX idx_projects_biotools_confidence ON projects(biotools_confidence DESC);
CREATE INDEX idx_projects_is_bio_related ON projects(is_bio_related);
CREATE INDEX idx_projects_fiscal_year ON projects(fiscal_year);
CREATE INDEX idx_projects_funding_mechanism ON projects(funding_mechanism);
CREATE INDEX idx_projects_org_type ON projects(org_type);
CREATE INDEX idx_projects_award_date ON projects(award_date);

-- Vector similarity indexes (ivfflat - fast approximate search)
CREATE INDEX idx_projects_title_embedding ON projects 
  USING ivfflat (title_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_projects_phr_embedding ON projects 
  USING ivfflat (phr_embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX idx_projects_abstract_embedding ON projects 
  USING ivfflat (abstract_embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full-text search (backup for keyword search)
CREATE INDEX idx_projects_title_fts ON projects USING GIN (to_tsvector('english', title));
CREATE INDEX idx_projects_terms_fts ON projects USING GIN (to_tsvector('english', COALESCE(terms, '')));

-- ----------------------------------------------------------------------------
-- ABSTRACTS
-- ----------------------------------------------------------------------------
CREATE TABLE abstracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id VARCHAR(20) REFERENCES projects(application_id) ON DELETE CASCADE,
  abstract_text TEXT NOT NULL,
  abstract_length INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_abstracts_application_id ON abstracts(application_id);

-- ----------------------------------------------------------------------------
-- PUBLICATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE publications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pmid VARCHAR(20) UNIQUE NOT NULL,
  
  -- Publication Details
  pub_title TEXT,
  journal_title VARCHAR(500),
  journal_abbr VARCHAR(100),
  pub_year INT,
  pub_date DATE,
  
  -- Authors
  author_list TEXT,
  affiliation TEXT,
  
  -- Identifiers
  pmc_id VARCHAR(20),
  issn VARCHAR(20),
  
  -- Classification Helpers (computed during ETL)
  is_methods_journal BOOLEAN DEFAULT false,
  is_therapeutic_journal BOOLEAN DEFAULT false,
  is_computational_journal BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_publications_pmid ON publications(pmid);
CREATE INDEX idx_publications_journal_abbr ON publications(journal_abbr);
CREATE INDEX idx_publications_pub_year ON publications(pub_year);
CREATE INDEX idx_publications_is_methods_journal ON publications(is_methods_journal);
CREATE INDEX idx_publications_is_therapeutic_journal ON publications(is_therapeutic_journal);

-- ----------------------------------------------------------------------------
-- PATENTS
-- ----------------------------------------------------------------------------
CREATE TABLE patents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patent_id VARCHAR(50) UNIQUE NOT NULL,
  project_number VARCHAR(50), -- References projects(project_number)
  
  -- Patent Details
  patent_title TEXT,
  patent_org VARCHAR(500),
  filing_date DATE, -- Not in current NIH export, but reserving field
  issue_date DATE,  -- Not in current NIH export, but reserving field
  patent_type VARCHAR(50), -- Not in current NIH export, but reserving field
  
  -- Classification Helpers (computed during ETL)
  is_device_patent BOOLEAN DEFAULT false,
  is_therapeutic_patent BOOLEAN DEFAULT false,
  is_method_patent BOOLEAN DEFAULT false,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_patents_patent_id ON patents(patent_id);
CREATE INDEX idx_patents_project_number ON patents(project_number);
CREATE INDEX idx_patents_is_device_patent ON patents(is_device_patent);
CREATE INDEX idx_patents_is_therapeutic_patent ON patents(is_therapeutic_patent);

-- ----------------------------------------------------------------------------
-- CLINICAL STUDIES
-- ----------------------------------------------------------------------------
CREATE TABLE clinical_studies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_number VARCHAR(50), -- References projects(project_number)
  
  -- Trial Details
  nct_id VARCHAR(20) NOT NULL,
  study_title TEXT,
  study_status VARCHAR(50),
  
  -- Classification Helpers (computed during ETL)
  is_diagnostic_trial BOOLEAN DEFAULT false,
  is_therapeutic_trial BOOLEAN DEFAULT true, -- Default assumption
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clinical_project_number ON clinical_studies(project_number);
CREATE INDEX idx_clinical_nct_id ON clinical_studies(nct_id);
CREATE INDEX idx_clinical_is_therapeutic_trial ON clinical_studies(is_therapeutic_trial);

-- ----------------------------------------------------------------------------
-- PROJECT_PUBLICATIONS (Link Table)
-- ----------------------------------------------------------------------------
CREATE TABLE project_publications (
  project_number VARCHAR(50) REFERENCES projects(project_number) ON DELETE CASCADE,
  pmid VARCHAR(20) REFERENCES publications(pmid) ON DELETE CASCADE,
  PRIMARY KEY (project_number, pmid),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_project_publications_project ON project_publications(project_number);
CREATE INDEX idx_project_publications_pmid ON project_publications(pmid);

-- ============================================================================
-- ADMIN & METADATA TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- DATA_IMPORTS (Track Import Jobs)
-- ----------------------------------------------------------------------------
CREATE TABLE data_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Import Details
  year INT NOT NULL,
  agency funding_agency NOT NULL,
  import_date TIMESTAMPTZ DEFAULT NOW(),
  imported_by VARCHAR(255), -- Email or username
  
  -- Files Imported
  projects_file VARCHAR(255),
  publications_file VARCHAR(255),
  patents_file VARCHAR(255),
  clinical_file VARCHAR(255),
  links_file VARCHAR(255),
  abstracts_file VARCHAR(255),
  
  -- Stats
  projects_added INT DEFAULT 0,
  projects_updated INT DEFAULT 0,
  publications_added INT DEFAULT 0,
  patents_added INT DEFAULT 0,
  clinical_studies_added INT DEFAULT 0,
  
  -- Processing Details
  embeddings_generated INT DEFAULT 0,
  classification_run BOOLEAN DEFAULT false,
  processing_time_seconds INT,
  openai_cost DECIMAL(10,2),
  
  -- Status
  status job_status DEFAULT 'queued',
  error_message TEXT,
  
  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

CREATE INDEX idx_data_imports_year ON data_imports(year);
CREATE INDEX idx_data_imports_agency ON data_imports(agency);
CREATE INDEX idx_data_imports_status ON data_imports(status);
CREATE INDEX idx_data_imports_import_date ON data_imports(import_date DESC);

-- ----------------------------------------------------------------------------
-- PROCESSING_JOBS (Background Job Tracking)
-- ----------------------------------------------------------------------------
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Job Details
  job_type VARCHAR(50) NOT NULL, -- 'dataset_import', 'weekly_sync', 'reclassification', etc.
  status job_status DEFAULT 'queued',
  
  -- Progress
  current_step VARCHAR(100),
  progress FLOAT DEFAULT 0, -- 0-100
  status_message TEXT,
  
  -- Stats
  stats JSONB, -- {projects_loaded: 1000, embeddings_generated: 3000, etc.}
  
  -- Errors
  errors JSONB, -- Array of error messages
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX idx_processing_jobs_created_at ON processing_jobs(created_at DESC);

-- ============================================================================
-- MATERIALIZED VIEWS (Performance Optimization)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PROJECTS_ENRICHED (Pre-computed Aggregations)
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW projects_enriched AS
SELECT 
  p.*,
  
  -- Publication counts
  COUNT(DISTINCT pub.pmid) as publication_count,
  COUNT(DISTINCT CASE WHEN pub.is_methods_journal THEN pub.pmid END) as methods_journal_count,
  COUNT(DISTINCT CASE WHEN pub.is_therapeutic_journal THEN pub.pmid END) as therapeutic_journal_count,
  
  -- Patent counts
  COUNT(DISTINCT pat.patent_id) as patent_count,
  COUNT(DISTINCT CASE WHEN pat.is_device_patent THEN pat.patent_id END) as device_patent_count,
  COUNT(DISTINCT CASE WHEN pat.is_therapeutic_patent THEN pat.patent_id END) as therapeutic_patent_count,
  
  -- Clinical trial counts
  COUNT(DISTINCT cs.nct_id) as clinical_trial_count,
  COUNT(DISTINCT CASE WHEN cs.is_therapeutic_trial THEN cs.nct_id END) as therapeutic_trial_count,
  
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

-- Indexes on materialized view
CREATE INDEX idx_projects_enriched_biotools_confidence 
  ON projects_enriched(biotools_confidence DESC);
CREATE INDEX idx_projects_enriched_publication_count 
  ON projects_enriched(publication_count);
CREATE INDEX idx_projects_enriched_patent_count 
  ON projects_enriched(patent_count);

-- ----------------------------------------------------------------------------
-- BIOTOOLS_HIGH_CONFIDENCE (Quick Access to Top Matches)
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW biotools_high_confidence AS
SELECT * FROM projects_enriched
WHERE biotools_confidence >= 60
  AND is_bio_related = true
ORDER BY biotools_confidence DESC;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Function: Refresh Materialized Views
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY projects_enriched;
  REFRESH MATERIALIZED VIEW CONCURRENTLY biotools_high_confidence;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Function: Vector Similarity Search
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_projects(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 50,
  min_biotools_confidence FLOAT DEFAULT 35
)
RETURNS TABLE (
  id UUID,
  project_number VARCHAR(50),
  title TEXT,
  org_name VARCHAR(500),
  biotools_confidence FLOAT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.project_number,
    p.title,
    p.org_name,
    p.biotools_confidence,
    1 - (p.title_embedding <=> query_embedding) as similarity
  FROM projects p
  WHERE 
    p.is_bio_related = true
    AND p.biotools_confidence >= min_biotools_confidence
    AND 1 - (p.title_embedding <=> query_embedding) > match_threshold
  ORDER BY p.title_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Function: Vector Similarity Search for Patents
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_patents(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 20
)
RETURNS TABLE (
  patent_id VARCHAR(50),
  patent_title TEXT,
  project_number VARCHAR(50),
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.patent_id,
    p.patent_title,
    p.project_number,
    1 - (p.patent_embedding <=> query_embedding) as similarity
  FROM patents p
  WHERE
    p.patent_embedding IS NOT NULL
    AND 1 - (p.patent_embedding <=> query_embedding) > match_threshold
  ORDER BY p.patent_embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Function: Get Project Publications
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_project_publications(proj_num VARCHAR)
RETURNS TABLE (
  pmid VARCHAR(20),
  pub_title TEXT,
  journal_abbr VARCHAR(100),
  pub_year INT,
  is_methods_journal BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pub.pmid,
    pub.pub_title,
    pub.journal_abbr,
    pub.pub_year,
    pub.is_methods_journal
  FROM publications pub
  JOIN project_publications pp ON pub.pmid = pp.pmid
  WHERE pp.project_number = proj_num
  ORDER BY pub.pub_year DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE abstracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patents ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Public read access (using anon key)
CREATE POLICY "Public read access" ON projects
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON abstracts
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON publications
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON patents
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON clinical_studies
  FOR SELECT USING (true);

CREATE POLICY "Public read access" ON project_publications
  FOR SELECT USING (true);

-- Admin-only access for metadata tables
-- Note: Implement auth later, for now use service role key for admin operations
CREATE POLICY "Admin only" ON data_imports
  FOR ALL USING (false); -- Will be updated with auth.role() = 'admin' later

CREATE POLICY "Admin only" ON processing_jobs
  FOR ALL USING (false); -- Will be updated with auth.role() = 'admin' later

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp on projects
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SAMPLE DATA (For Testing)
-- ============================================================================

-- Insert a sample project for testing
INSERT INTO projects (
  application_id,
  project_number,
  title,
  phr,
  org_name,
  org_type,
  funding_mechanism,
  total_cost,
  fiscal_year,
  funding_agency,
  primary_category,
  biotools_confidence
) VALUES (
  '12345678',
  'R44GM123456',
  'Development of a Novel Protein Microarray Platform',
  'We aim to develop a commercial-ready benchtop instrument for high-throughput protein analysis that will enable researchers to rapidly screen thousands of proteins.',
  'ACME Biotools Inc.',
  'company',
  'SBIR-STTR',
  1250000.00,
  2025,
  'NIH',
  'biotools',
  92.5
);

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE projects IS 'Core NIH grant data with classification results';
COMMENT ON TABLE abstracts IS 'Full project abstracts (longer than PHR)';
COMMENT ON TABLE publications IS 'Research publications linked to grants';
COMMENT ON TABLE patents IS 'Patents filed from grant-funded research';
COMMENT ON TABLE clinical_studies IS 'Clinical trials associated with grants';
COMMENT ON TABLE project_publications IS 'Many-to-many link between projects and publications';
COMMENT ON TABLE data_imports IS 'Audit trail of data import jobs';
COMMENT ON TABLE processing_jobs IS 'Background job status tracking';

COMMENT ON COLUMN projects.biotools_confidence IS 'Classification confidence score (0-100) for biotools category';
COMMENT ON COLUMN projects.biotools_signals IS 'JSON array of classification signals with tier, source, signal name, and weight';
COMMENT ON COLUMN projects.title_embedding IS 'Vector embedding of project title (1536 dims, OpenAI text-embedding-3-small)';
COMMENT ON COLUMN publications.is_methods_journal IS 'True if journal focuses on methods/tools (e.g., Nature Methods, JOVE)';
COMMENT ON COLUMN patents.is_device_patent IS 'True if patent is for a device/system/apparatus (biotools indicator)';

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

-- Verify schema
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
