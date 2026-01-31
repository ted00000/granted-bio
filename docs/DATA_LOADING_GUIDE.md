# Data Loading Guide for granted.bio

This guide documents the steps to load new fiscal year data (e.g., 2024, 2026) into the granted.bio database.

## Prerequisites

- Python 3.12+ with dependencies installed
- `.env.local` file with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY` (for classification)
- Access to Supabase SQL Editor (for migrations)

## Data Files

Download CSV files from NIH RePORTER (https://reporter.nih.gov/exporter) and place in `data/raw/`:

| File | Description |
|------|-------------|
| `RePORTER_PRJ_C_FY{YEAR}.csv` | Projects |
| `RePORTER_PRJABS_C_FY{YEAR}.csv` | Project abstracts |
| `RePORTER_PUB_C_FY{YEAR}.csv` | Publications |
| `RePORTER_PUBLNK_C_FY{YEAR}.csv` | Project-publication links |
| `RePORTER_PATENTS_C_FY{YEAR}.csv` | Patents |
| `ClinicalStudies.csv` | Clinical studies |

## Step-by-Step Process

### Step 1: Load Raw Data to Supabase

```bash
cd /Users/tednunes/Projects/granted-bio
python3 etl/load_to_supabase.py --data-dir data/raw
```

This loads:
- Projects (with initial classification)
- Abstracts
- Publications
- Patents
- Clinical studies
- Project-publication links

**Estimated time:** 30-60 minutes for ~60K projects

### Step 2: Generate Project Embeddings

```bash
python3 etl/generate_embeddings_batched.py
```

Generates embeddings for projects using title + PHR + terms + abstract.

**Estimated time:** ~4-6 hours for 60K projects
**Estimated cost:** ~$1.50

### Step 3: Generate Patent Embeddings

```bash
python3 etl/generate_patent_embeddings.py
```

Generates embeddings for patent titles.

**Estimated time:** ~4 hours for 46K patents
**Estimated cost:** ~$0.50

### Step 4: Generate Publication Embeddings

```bash
python3 etl/generate_publication_embeddings.py
```

Generates embeddings for publication titles.

**Estimated time:** ~3-4 hours for 100K publications
**Estimated cost:** ~$2.00

### Step 5: Generate Clinical Study Embeddings

```bash
python3 etl/generate_clinical_embeddings.py
```

Generates embeddings for clinical study titles.

**Estimated time:** ~2 hours for 38K studies
**Estimated cost:** ~$0.40

### Step 6: Run AI Classification (if needed)

If projects need classification/re-classification:

```bash
python3 etl/classify_projects_batched.py
```

Uses Claude 3.5 Haiku to classify projects into:
- biotools
- therapeutics
- diagnostics
- medical_device
- digital_health
- other

**Estimated time:** ~2-4 hours for 60K projects
**Estimated cost:** ~$5-10 (Anthropic API)

### Step 7: Extract Emails from Publications

```bash
python3 etl/extract_emails.py
```

Parses PI email addresses from publication affiliation fields.

**Estimated time:** ~2-3 hours for 100K publications
**Expected yield:** ~13% of publications have extractable emails

### Step 8: Verify Data Quality

```bash
python3 etl/data_audit.py
```

Checks:
- Table counts
- Embedding coverage (should be 100%)
- Cross-linking coverage
- Classification coverage
- Email extraction coverage

### Step 9: Test Vector Search

```bash
python3 etl/test_vector_search.py
```

Runs test queries to verify semantic search is working.

## Database Migrations

If loading data for the first time or adding new columns, run these in Supabase SQL Editor:

### Patent Embeddings (009)
```sql
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_embedding VECTOR(1536);
CREATE INDEX IF NOT EXISTS idx_patents_embedding
  ON patents USING ivfflat (patent_embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Publication Embeddings (010)
```sql
ALTER TABLE publications ADD COLUMN IF NOT EXISTS publication_embedding VECTOR(1536);
CREATE INDEX IF NOT EXISTS idx_publications_embedding
  ON publications USING ivfflat (publication_embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Clinical Study Embeddings (011)
```sql
ALTER TABLE clinical_studies ADD COLUMN IF NOT EXISTS study_embedding VECTOR(1536);
CREATE INDEX IF NOT EXISTS idx_clinical_studies_embedding
  ON clinical_studies USING ivfflat (study_embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Publication Emails (013)
```sql
ALTER TABLE publications ADD COLUMN IF NOT EXISTS pi_email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_publications_email
  ON publications (pi_email)
  WHERE pi_email IS NOT NULL AND pi_email != '';
```

## Cost Summary

For a typical fiscal year (~60K projects):

| Task | Estimated Cost |
|------|---------------|
| Project embeddings | $1.50 |
| Patent embeddings | $0.50 |
| Publication embeddings | $2.00 |
| Clinical study embeddings | $0.40 |
| AI Classification | $5-10 |
| **Total** | **~$10-15** |

## Incremental Updates (2026 Ongoing)

For ongoing 2026 data (monthly/quarterly updates):

1. Download new CSV files from NIH RePORTER
2. Run `load_to_supabase.py` - uses UPSERT so existing records are updated
3. Run embedding scripts - they skip records that already have embeddings
4. Run classification - skip already classified or use `--force` flag
5. Run email extraction - skips records with existing pi_email
6. Verify with data audit

The scripts are designed to be idempotent - running them multiple times is safe.

## Troubleshooting

### Embedding script hangs
- Check OpenAI API status
- Reduce batch size in script
- Script can be restarted safely - it continues where it left off

### Type errors in search function
- Check that search_projects function matches actual column types
- Common issues: NUMERIC vs BIGINT, custom types vs VARCHAR
- See migration 012 for correct types

### Missing cross-links
- Ensure project-publication link file is loaded
- Patents and clinical studies link via `project_number` field

## File Locations

```
granted-bio/
├── data/
│   └── raw/              # CSV files go here
├── etl/
│   ├── load_to_supabase.py
│   ├── generate_embeddings_batched.py
│   ├── generate_patent_embeddings.py
│   ├── generate_publication_embeddings.py
│   ├── generate_clinical_embeddings.py
│   ├── classify_projects_batched.py
│   ├── extract_emails.py
│   ├── data_audit.py
│   └── test_vector_search.py
└── supabase/
    └── migrations/       # SQL migrations
```
