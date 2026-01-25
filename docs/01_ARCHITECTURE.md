# 01: System Architecture

**Document:** Architecture & Design Decisions  
**Last Updated:** January 25, 2026  
**Status:** Final for MVP

---

## System Overview

granted.bio is a three-tier application:
1. **Data Layer:** Supabase (PostgreSQL + pgvector)
2. **Application Layer:** Next.js (API routes + server components)
3. **Presentation Layer:** React (search interface + admin dashboard)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA SOURCES                            │
├─────────────────────────────────────────────────────────────┤
│  NIH CSV Exports    │  NIH API v2   │  NSF API (future)    │
│  (bulk historical)  │  (incremental)│  (incremental)       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   ETL PIPELINE (Python)                      │
├─────────────────────────────────────────────────────────────┤
│  CSV Parsing  →  Transform  →  Validate  →  Enrich         │
│  • Projects      • Schema       • Required   • Embeddings   │
│  • Publications  • Mapping      • Fields     • Journal      │
│  • Patents       • Normalize    • Data Types   Classification│
│  • Clinical      • Join Keys    • Ranges     • Patent Types │
│  • Links                                                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              CLASSIFICATION ENGINE (Python/TS)               │
├─────────────────────────────────────────────────────────────┤
│  Bio Boundary Check  →  Multi-Tier Scoring  →  Confidence  │
│  • Life sciences      • Tier 1: Core          • 0-34: LOW   │
│    keywords           • Tier 2: Abstract      • 35-59: MOD  │
│  • NIH institutes     • Tier 3: Publications  • 60-100: HIGH│
│  • Exclude non-bio    • Tier 4: Patents                     │
│                       • Tier 5: Clinical                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  DATABASE (Supabase)                         │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL 15  +  pgvector extension                       │
│                                                              │
│  Tables:                      Indexes:                       │
│  • projects (150K/year)       • Vector similarity (ivfflat) │
│  • abstracts                  • Category filters            │
│  • publications (400K/year)   • Agency filters              │
│  • patents (25K/year)         • Confidence scores           │
│  • clinical_studies           • Timestamp ranges            │
│  • project_publications                                     │
│                                                              │
│  Materialized Views:                                         │
│  • projects_enriched (with counts, signals)                 │
│  • biotools_high_confidence                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                APPLICATION LAYER (Next.js)                   │
├─────────────────────────────────────────────────────────────┤
│  API Routes:                  Server Components:            │
│  • /api/search                • Search page                 │
│  • /api/company/[id]          • Company detail              │
│  • /api/admin/upload          • Admin dashboard             │
│  • /api/admin/process                                       │
│                                                              │
│  Services:                                                   │
│  • Supabase client (DB access)                              │
│  • OpenAI client (embeddings)                               │
│  • Classification service                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              PRESENTATION LAYER (React)                      │
├─────────────────────────────────────────────────────────────┤
│  Public Pages:                Admin Pages:                  │
│  • Homepage                   • Data upload                 │
│  • Search results             • Processing monitor          │
│  • Company detail             • Classification tuning       │
│  • Category pages             • Data status                 │
│                                                              │
│  Components:                                                 │
│  • SearchInterface            • AdminUpload                 │
│  • CompanyCard                • JobMonitor                  │
│  • CompanyTimeline            • ClassificationReview        │
│  • FilterPanel                                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
                         [Users via Browser]
```

---

## Key Architectural Decisions

### Decision 1: CSV + API Hybrid (Not API-Only)

**Why:**
- NIH API has 15,000 record pagination limit (can't fetch 150K+ records)
- Publications API returns minimal data (no journal names needed for classification)
- Patents and clinical studies not available via API
- CSV exports provide complete, validated historical data

**Implementation:**
- **Initial load:** CSV bulk exports (all 6 datasets, 2022-2025)
- **Weekly sync:** API for new awards (last 7 days, typically <500 records)
- **Weekly enrichment:** CSV downloads for new publications/patents

**Trade-offs:**
- ✅ Complete data access
- ✅ No API rate limit concerns
- ✅ Better classification signals
- ⚠️ Weekly latency for some updates (acceptable for use case)

---

### Decision 2: Supabase (Not Self-Hosted PostgreSQL)

**Why:**
- Built-in pgvector support (no manual setup)
- Generous free tier (500MB) for MVP
- Easy scaling to Pro tier ($25/mo for 8GB)
- Real-time subscriptions (future feature potential)
- Excellent TypeScript SDK
- Managed backups and security

**Implementation:**
- Use Supabase SDK for all database access
- Row-level security for admin vs. public access
- Connection pooling handled automatically
- Automatic indexes via migration scripts

**Trade-offs:**
- ✅ Fast development, no DevOps
- ✅ Built-in auth (if needed later)
- ⚠️ Vendor lock-in (mitigated: standard PostgreSQL, easy to export)
- ⚠️ Cost at scale (acceptable: ~$25-50/mo for expected volume)

---

### Decision 3: Multi-Tier Classification (Not Single-Score)

**Why:**
- Single signals are unreliable (SBIR companies can be therapeutic)
- Combining signals improves accuracy (70% → 90%)
- Explainability (show WHY a company was classified)
- Flexibility (can adjust weights per tier without rewriting algorithm)

**Implementation:**
5 tiers with weighted scoring:
1. **Core signals** (projects table): SBIR, org type, PHR/title keywords
2. **Abstract analysis** (text): Developer vs. user language patterns
3. **Publications** (journals): Methods journals vs. therapeutic journals
4. **Patents** (types): Device/system patents vs. therapeutic patents
5. **Clinical trials** (exclusion): Presence of therapeutic trials = -30 points

**Trade-offs:**
- ✅ Higher accuracy (85-90% vs. 70%)
- ✅ Explainable results
- ✅ Easy to tune
- ⚠️ More complex than simple rules
- ⚠️ Requires all 5 datasets (mitigated: we have them from CSVs)

---

### Decision 4: Embeddings for Search (Not Full-Text Only)

**Why:**
- Semantic search finds conceptually similar companies
- "CRISPR gene editing platform" matches "genome engineering tool" (different words, same concept)
- Better user experience than keyword-only search
- Enables future features (similar companies, recommendations)

**Implementation:**
- Generate embeddings for: title, PHR, abstract (3 per project)
- Use OpenAI text-embedding-3-small (cheap, good quality)
- Store in pgvector columns with ivfflat indexes
- Combine vector similarity + filters for hybrid search

**Cost:**
- Initial: 450K embeddings × $0.0001 = $45 one-time (2025 data)
- Weekly: ~1,500 new × $0.0001 = $0.15/week
- Total: ~$50 first year

**Trade-offs:**
- ✅ Much better search UX
- ✅ Finds semantically similar results
- ⚠️ Adds $50 initial cost (acceptable)
- ⚠️ Vector search slightly slower than text search (acceptable with indexes)

---

### Decision 5: Bio Boundary Filter (Not All Grants)

**Why:**
- granted.bio is life sciences focused (not aerospace, materials science, etc.)
- Prevents confusion and improves UX
- Reduces database size and costs
- Clearer product positioning

**Implementation:**
- Filter applied during ETL (before loading to database)
- Keyword-based: biology, biotech, medical, disease, genomics, etc.
- NIH institute check: All NIH grants are bio (by definition)
- Exclude: aerospace, nuclear, civil engineering (unless biomaterials)

**Result:**
- ~60% of total NIH grants pass bio filter
- Database: ~90K projects/year instead of 150K
- Savings: ~$15/mo on storage, faster queries

**Trade-offs:**
- ✅ Focused product, clearer positioning
- ✅ Lower costs, faster searches
- ⚠️ Can't expand beyond bio without rebuild (acceptable: bio is the plan)

---

## Data Flow Details

### Initial Data Load (One-Time)

```python
# Step 1: Download CSVs from NIH
wget https://reporter.nih.gov/exporter/projects/2025.csv
wget https://reporter.nih.gov/exporter/publications/2025.csv
# ... (all 6 files)

# Step 2: Process and filter
python etl/process_projects.py \
  --input data/projects_2025.csv \
  --output processed/projects_2025.json \
  --bio-filter

# Step 3: Generate embeddings
python etl/generate_embeddings.py \
  --input processed/projects_2025.json \
  --output processed/projects_2025_embedded.json

# Step 4: Classify
python etl/classify_projects.py \
  --input processed/projects_2025_embedded.json \
  --output processed/projects_2025_classified.json

# Step 5: Load to Supabase
python etl/load_to_supabase.py \
  --input processed/projects_2025_classified.json
```

**Time:** 2-3 hours for full 2025 dataset
**Cost:** ~$50 (OpenAI embeddings)

---

### Weekly Sync (Automated)

```python
# Cron: Every Sunday at 2 AM EST
# File: etl/weekly_sync.py

# Step 1: Fetch new awards via API (last 7 days)
new_projects = fetch_nih_api(
    from_date='2026-01-18',
    to_date='2026-01-25'
)
# Typically: 200-500 new projects

# Step 2: Download latest CSVs for enrichment
download_latest_csvs(['publications', 'patents', 'clinical'])

# Step 3: Check for new publications/patents for existing projects
new_pubs = find_new_publications(existing_projects)
new_patents = find_new_patents(existing_projects)

# Step 4: Process new projects (embeddings + classification)
process_projects(new_projects)

# Step 5: Load incremental updates
load_incremental_updates(new_projects, new_pubs, new_patents)

# Step 6: Recompute classification for projects with new signals
recompute_affected_classifications()

# Step 7: Refresh materialized views
refresh_materialized_views()
```

**Time:** 15-30 minutes
**Cost:** ~$0.50/week (API calls + embeddings)

---

## Scaling Considerations

### Current (MVP - 2025 data only)

**Database:**
- Projects: 90K × 3KB = 270 MB
- Publications: 240K × 1KB = 240 MB
- Patents: 15K × 500B = 7 MB
- Embeddings: 90K × 3 × 6KB = 1.6 GB
- **Total: ~2 GB** → Supabase Pro tier ($25/mo)

**Search Performance:**
- Vector similarity: ~500ms (with ivfflat index)
- Filtered search: ~200ms
- Combined: ~800ms
- Target: <2 seconds total (including network) ✅

---

### Year 1 (2022-2025 data)

**Database:**
- 4 years × 2GB = ~8 GB → Supabase Pro tier still works

**Search Performance:**
- Still sub-2 seconds (indexes scale well to 400K projects)

---

### Year 2 (Add NSF + DOD)

**Database:**
- NIH: 8 GB
- NSF: ~3 GB (smaller dataset)
- DOD: ~2 GB (SBIR only)
- **Total: ~13 GB** → May need Team tier ($50/mo) or optimize

**Optimization options:**
- Archive projects older than 5 years
- Remove low-confidence projects (score <20)
- Compress embeddings (reduce dimensions)

---

## Security & Access Control

### Public Access (No Auth Required)

**Read-only access to:**
- Search functionality
- Company detail pages
- CSV export (with rate limiting)

**Implementation:**
- Use Supabase anon key (read-only)
- Row-level security: `SELECT` only on public tables
- Rate limiting: 100 searches/hour per IP

---

### Admin Access (Protected)

**Full access to:**
- Data upload
- Processing jobs
- Classification tuning
- System status

**Implementation:**
- Simple password protection (MVP)
- Later: Supabase Auth (email/password)
- Row-level security: `INSERT`, `UPDATE`, `DELETE` only with admin role

---

## Deployment Strategy

### Development
```
Local: localhost:3000
Database: Supabase dev project
API: Development keys
```

### Staging (Optional)
```
URL: staging.granted.bio (Vercel preview)
Database: Supabase staging project (separate)
API: Staging keys
```

### Production
```
URL: granted.bio (Vercel production)
Database: Supabase production project
API: Production keys
Environment: Vercel production deployment
```

---

## Monitoring & Observability

### Application Metrics
- Search latency (p50, p95, p99)
- API error rates
- Database query performance
- Weekly data sync success rate

**Tools:**
- Vercel Analytics (built-in)
- Supabase Dashboard (query stats)
- Custom logging (Winston or Pino)

### Business Metrics
- Total projects in database
- Classification distribution (HIGH/MOD/LOW)
- Search queries per day
- CSV exports per week
- Admin uploads per month

**Implementation:**
- PostgreSQL queries (aggregate tables)
- Simple dashboard in admin section

---

## Disaster Recovery

### Backup Strategy
- Supabase: Automatic daily backups (retention: 7 days on Pro tier)
- CSV source files: Keep original downloads in S3 or local backup
- Database dumps: Weekly pg_dump to S3 (redundancy)

### Recovery Procedures
1. **Database corruption:** Restore from Supabase backup (last 7 days)
2. **Data loss:** Re-run ETL from original CSVs
3. **Complete failure:** Redeploy app + restore database

**RTO (Recovery Time Objective):** 4 hours
**RPO (Recovery Point Objective):** 24 hours (daily backups)

---

## Performance Targets

### MVP (Week 4)
- Search response: <2 seconds (p95)
- Page load: <1 second (p95)
- Database queries: <500ms (p95)
- Uptime: 99% (Vercel + Supabase SLAs)

### Production (Month 3)
- Search response: <1 second (p95)
- Page load: <500ms (p95)
- Database queries: <200ms (p95)
- Uptime: 99.5%

---

## Technology Alternatives Considered

| Decision | Chosen | Alternatives Considered | Why Not |
|----------|--------|------------------------|---------|
| **Database** | Supabase | Self-hosted PostgreSQL | More DevOps, no pgvector by default |
| | | PlanetScale (MySQL) | No vector support |
| | | MongoDB | Harder for complex joins |
| **Frontend** | Next.js | Remix | Smaller ecosystem |
| | | SvelteKit | Less familiar |
| | | Pure React SPA | Need SSR for SEO |
| **Embeddings** | OpenAI | Cohere | More expensive |
| | | Sentence-Transformers | Self-host complexity |
| **Hosting** | Vercel | Railway | Less mature for Next.js |
| | | Render | Similar but less integrated |
| | | AWS | Overkill for MVP |

---

## Future Architecture Considerations

### When to Add Redis Cache
**Trigger:** Search response > 2 seconds consistently
**Use case:** Cache common searches, company detail pages
**Cost:** ~$10/mo (Upstash Redis)

### When to Add Background Job Queue
**Trigger:** ETL processing blocks admin UI
**Use case:** Long-running jobs (bulk uploads, reclassification)
**Options:** Inngest, BullMQ, or Supabase Edge Functions
**Cost:** ~$20/mo

### When to Add CDN
**Trigger:** Global users with slow load times
**Use case:** Static assets, company detail pages
**Options:** Vercel Edge Network (included) or Cloudflare
**Cost:** Free (Vercel) or $20/mo (Cloudflare Pro)

---

## Architectural Risks & Mitigations

### Risk 1: Supabase Free Tier Limit (500MB)
**Impact:** Can't load full 2025 dataset
**Mitigation:** Budget $25/mo for Pro tier from start
**Contingency:** Sample 2025 data (e.g., only SBIR grants) for free tier proof-of-concept

### Risk 2: OpenAI API Costs Spike
**Impact:** Embeddings become too expensive
**Mitigation:** Monitor costs, set spending limits ($100/mo max)
**Contingency:** Switch to open-source embeddings (Sentence-Transformers, self-hosted)

### Risk 3: Vector Search Performance Degrades
**Impact:** Searches become slow (>5 seconds)
**Mitigation:** Optimize indexes, use materialized views, add filters to narrow search space
**Contingency:** Hybrid search (keyword first, then vector for refinement)

### Risk 4: NIH Changes CSV Format
**Impact:** ETL pipeline breaks
**Mitigation:** Version control ETL scripts, schema validation before processing
**Contingency:** Manual schema mapping, update ETL scripts

---

## Summary

**Chosen architecture:**
- ✅ Balances simplicity (Supabase, Next.js) with power (vector search, multi-tier classification)
- ✅ Optimizes for development speed (managed services, serverless)
- ✅ Keeps costs low ($47/mo for production)
- ✅ Scales to expected volume (400K projects, 1000s of searches/day)
- ✅ Supports future expansion (more agencies, more categories)

**This architecture supports the 4-week MVP timeline and positions granted.bio for growth.**
