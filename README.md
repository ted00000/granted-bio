# granted.bio - Life Sciences Grant Intelligence Platform

**Version:** 1.0 MVP  
**Target Launch:** February 2026  
**Status:** Development Phase

---

## Project Overview

granted.bio is a life sciences grant intelligence platform that helps VCs, consultants, and corporate development teams research bio companies through their federal funding history.

**Key Value Proposition:**
> Don't take opportunities for granted.

We analyze NIH, NSF, and DOD grant data to identify promising biotools, diagnostics, therapeutics, and medical device companies based on their funding patterns, SBIR progression, patent activity, and publication history.

---

## Core Features (MVP)

### Phase 1 (Weeks 1-4)
- ✅ NIH 2025 data processing (500K+ grants)
- ✅ Biotools company classification (AI-powered, multi-tier scoring)
- ✅ Natural language search interface
- ✅ Company detail pages with funding timeline
- ✅ CSV export functionality
- ✅ Admin data upload interface

### Phase 2 (Month 2-3)
- Diagnostics & therapeutics categories
- Historical data (2022-2024)
- NSF and DOD data integration
- Advanced filtering and analytics

---

## Technology Stack

**Frontend:**
- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- Vercel deployment

**Backend:**
- Supabase (PostgreSQL + pgvector)
- Next.js API routes
- OpenAI API (embeddings & classification)

**ETL/Processing:**
- Python scripts (CSV processing)
- Node.js scripts (embeddings generation)
- Background jobs (weekly sync)

**Data Sources:**
- NIH RePORTER CSV exports (bulk historical)
- NIH RePORTER API v2 (weekly incremental)
- NSF API (future)
- DOD SBIR data (future)

---

## Architecture Overview

### Data Flow
```
NIH CSV Exports
    ↓
ETL Pipeline (Python)
    ↓
Transform & Validate
    ↓
Generate Embeddings (OpenAI)
    ↓
Multi-Tier Classification
    ↓
Supabase (PostgreSQL + pgvector)
    ↓
Next.js API Routes
    ↓
React Dashboard
```

### Classification Strategy
Multi-tier scoring system (0-100 confidence):
- **Tier 1:** Core signals (SBIR/STTR, org type, PHR language)
- **Tier 2:** Abstract analysis (developer vs user language)
- **Tier 3:** Publications (journal venues, volume)
- **Tier 4:** Patents (device vs therapeutic)
- **Tier 5:** Clinical trials (exclusion filter)

**Output:**
- HIGH confidence (60-100): Clear biotools developers
- MODERATE confidence (35-59): Likely developers, needs review
- LOW confidence (0-34): Unlikely or tool users

---

## Data Schema

### 6 Primary Tables
1. **projects** - Core grant data (150K records/year)
2. **abstracts** - Full project descriptions
3. **publications** - Research papers (400K records/year)
4. **patents** - IP filings (25K records/year)
5. **clinical_studies** - Clinical trials (30K records/year)
6. **project_publications** - Link table (many-to-many)

### Key Indexes
- Vector similarity search (title_embedding, phr_embedding, abstract_embedding)
- Multi-category classification
- Bio boundary filtering
- Agency filtering (NIH, NSF, DOD)

---

## Development Phases

### Week 1: Data Infrastructure
**Goal:** Process 2025 NIH data, load into Supabase

**Tasks:**
- [ ] Set up Supabase project
- [ ] Create database schema
- [ ] Build ETL pipeline for 6 CSV files
- [ ] Generate embeddings (OpenAI)
- [ ] Run classification engine
- [ ] Verify data quality

**Deliverable:** Supabase database with 2025 NIH data classified

---

### Week 2: Classification Engine
**Goal:** Refine biotools classification accuracy

**Tasks:**
- [ ] Implement multi-tier scoring
- [ ] Test on known examples
- [ ] Calibrate confidence thresholds
- [ ] Add signal tracking (why each classification)
- [ ] Create materialized views for performance

**Deliverable:** 85%+ classification accuracy on validation set

---

### Week 3: Main Dashboard
**Goal:** Deploy search interface to granted.bio

**Tasks:**
- [ ] Build search interface (natural language + filters)
- [ ] Company detail pages
- [ ] CSV export functionality
- [ ] Deploy to Vercel
- [ ] Set up custom domain (granted.bio)

**Deliverable:** Working dashboard at granted.bio

---

### Week 4: Admin Interface & Polish
**Goal:** Self-service data management

**Tasks:**
- [ ] Admin upload interface (drag & drop CSVs)
- [ ] Processing job monitoring
- [ ] Data status dashboard
- [ ] User feedback collection
- [ ] Learning agent framework

**Deliverable:** Production-ready platform

---

## File Structure

```
granted.bio/
├── README.md (this file)
├── docs/
│   ├── 01_ARCHITECTURE.md
│   ├── 02_DATABASE_SCHEMA.sql
│   ├── 03_CLASSIFICATION_ALGORITHM.md
│   ├── 04_ETL_PIPELINE.md
│   ├── 05_API_SPECIFICATION.md
│   ├── 06_UI_SPECIFICATIONS.md
│   └── 07_ADMIN_INTERFACE.md
├── etl/
│   ├── process_projects.py
│   ├── process_publications.py
│   ├── process_patents.py
│   ├── process_clinical.py
│   ├── generate_embeddings.py
│   └── classify_projects.py
├── app/
│   ├── (public)/
│   │   ├── page.tsx (homepage)
│   │   ├── search/page.tsx
│   │   └── company/[slug]/page.tsx
│   ├── admin/
│   │   ├── upload/page.tsx
│   │   ├── status/page.tsx
│   │   └── classification/page.tsx
│   └── api/
│       ├── search/route.ts
│       ├── company/[id]/route.ts
│       ├── admin/upload/route.ts
│       └── admin/process/route.ts
├── lib/
│   ├── supabase.ts
│   ├── openai.ts
│   ├── classification.ts
│   └── utils.ts
└── components/
    ├── SearchInterface.tsx
    ├── CompanyCard.tsx
    ├── CompanyTimeline.tsx
    ├── AdminUpload.tsx
    └── JobMonitor.tsx
```

---

## Quick Start for Claude Code

### Initial Setup
```bash
# 1. Create Next.js project
npx create-next-app@latest granted-bio --typescript --tailwind --app

# 2. Install dependencies
npm install @supabase/supabase-js openai zod date-fns

# 3. Set up environment variables
cp .env.example .env.local
# Add: SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY

# 4. Create Supabase schema
psql $DATABASE_URL < docs/02_DATABASE_SCHEMA.sql

# 5. Process 2025 data
python etl/process_projects.py data/projects_2025.csv
python etl/generate_embeddings.py
python etl/classify_projects.py
```

### Development
```bash
# Run dev server
npm run dev

# Process new data
python etl/process_projects.py data/new_data.csv

# Deploy to production
vercel deploy --prod
```

---

## Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_KEY=eyJxxx... (server-side only)

# OpenAI
OPENAI_API_KEY=sk-xxx...

# App
NEXT_PUBLIC_APP_URL=https://granted.bio
```

---

## Costs & Budget

**One-time:**
- OpenAI embeddings (2025 data): ~$50
- Domain registration: ~$20/year

**Monthly (estimated):**
- Supabase Pro: $25/mo (8GB database)
- OpenAI API (weekly sync): $10/mo
- Vercel Pro (optional): $20/mo
- **Total: ~$35-55/mo**

**Free tier option (bootstrap):**
- Supabase Free: 500MB (2025 only, no historical)
- Vercel Free: Unlimited
- OpenAI: Pay as you go
- **Total: ~$10/mo**

---

## Success Metrics

**Week 4 (MVP complete):**
- [ ] 150K+ NIH 2025 projects loaded
- [ ] 85%+ classification accuracy
- [ ] Sub-2s search response time
- [ ] 5 pilot users giving feedback

**Month 2 (Early traction):**
- [ ] 3-5 paying customers
- [ ] $500-1500 MRR
- [ ] Historical data (2022-2024) added
- [ ] Diagnostics category launched

**Month 6 (Product-market fit):**
- [ ] 10-20 customers
- [ ] $2K-10K MRR
- [ ] NSF/DOD data integrated
- [ ] All 5 bio categories live

---

## Documentation Map

Read in this order:

1. **README.md** (this file) - Overview and getting started
2. **01_ARCHITECTURE.md** - System architecture and design decisions
3. **02_DATABASE_SCHEMA.sql** - Complete database schema
4. **03_CLASSIFICATION_ALGORITHM.md** - Multi-tier classification logic
5. **04_ETL_PIPELINE.md** - Data processing pipeline
6. **05_API_SPECIFICATION.md** - API endpoints and contracts
7. **06_UI_SPECIFICATIONS.md** - Frontend components and UX
8. **07_ADMIN_INTERFACE.md** - Admin dashboard specifications

---

## Key Decisions Made

### Domain & Branding
- **Domain:** granted.bio (registered)
- **Tagline:** Life Sciences Grant Intelligence
- **Positioning:** "Don't take opportunities for granted"
- **Target:** VCs, consultants, corporate development teams

### Data Strategy
- **Initial:** NIH 2025 only (CSV bulk export)
- **Update:** Weekly API sync for new awards
- **Expansion:** Add 2022-2024 when revenue justifies

### Category Strategy
- **Phase 1:** Biotools only (MVP)
- **Phase 2:** Diagnostics + Therapeutics
- **Phase 3:** Medical Devices + Digital Health
- **Boundary:** Bio/life sciences only (no aerospace, materials, etc.)

### Technical Stack
- **Why Next.js:** Full-stack, serverless, great DX
- **Why Supabase:** PostgreSQL + pgvector, generous free tier
- **Why .bio TLD:** Category-specific, professional for life sciences

---

## Contact & Support

**Project Lead:** Ted Fichtl  
**Status:** Personal project (separate from i5 BioPartners)  
**Timeline:** 4 weeks to MVP (Feb 2026)  

---

## Next Steps

**For Claude Code:**

Start with:
1. Review all docs in `/docs` folder
2. Set up Supabase project
3. Create database schema (02_DATABASE_SCHEMA.sql)
4. Build ETL pipeline (04_ETL_PIPELINE.md)
5. Test with 2025 sample data

**Ask questions as needed - refer back to specific doc sections for details.**
