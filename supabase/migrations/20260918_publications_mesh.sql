-- Publications MeSH descriptors (2026-09-18).
--
-- Adds mesh_terms to publications. Unlocks cross-source MeSH linking —
-- a topic query can now surface both trials (which have condition_mesh
-- + intervention_mesh from CT.gov's derivedSection) and publications
-- tagged with the same MeSH descriptor.
--
-- One column instead of the two-way split we use on trials because
-- PubMed doesn't cleanly separate condition-vs-intervention at the
-- record level. PubMed emits a flat list of MeSH descriptors per
-- article. The tree branch a descriptor belongs to (C = diseases,
-- D = drugs, E = procedures) is separate metadata that requires a MeSH
-- tree lookup we don't want to run per-record.
--
-- We store MajorTopic MeSH only (the primary subject headings of the
-- paper, marked MajorTopicYN="Y" in efetch XML). MinorTopic headings
-- are noisier — most articles carry 10-20 minor headings covering
-- background material, which would dilute the topic-match signal.
--
-- Source: NCBI PubMed efetch XML. esummary (which we currently use for
-- title/journal metadata) does NOT include MeSH. See etl/fetch_pubmed_mesh.py.

ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS mesh_terms TEXT[];

CREATE INDEX IF NOT EXISTS idx_publications_mesh_terms_gin
  ON publications USING GIN (mesh_terms);

COMMENT ON COLUMN publications.mesh_terms IS
  'Major-topic MeSH descriptor terms for the article, sourced from PubMed efetch XML by etl/fetch_pubmed_mesh.py. Only descriptors marked MajorTopicYN="Y" are stored — minor topics are too noisy for topic-match use. NULL until the enrichment script has visited the row.';
