# Quick Start for Claude Code

**Project:** granted.bio  
**Your Role:** Implement the system based on these specifications  
**Timeline:** 4 weeks to MVP

---

## Step 1: Read the Documentation (5 minutes)

Read in this order:

1. **README.md** - Project overview and context
2. **01_ARCHITECTURE.md** - System design and decisions
3. **02_DATABASE_SCHEMA.sql** - Complete database schema
4. **03_CLASSIFICATION_ALGORITHM.md** - Multi-tier classification logic

---

## Step 2: Set Up Environment (15 minutes)

### Create Next.js Project
```bash
npx create-next-app@latest granted-bio \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*"

cd granted-bio
```

### Install Dependencies
```bash
npm install @supabase/supabase-js openai zod date-fns papaparse
npm install -D @types/papaparse
```

### Environment Variables
Create `.env.local`:
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Step 3: Create Database Schema (10 minutes)

### Option A: Supabase SQL Editor
1. Go to Supabase dashboard → SQL Editor
2. Copy contents of `02_DATABASE_SCHEMA.sql`
3. Run the script

### Option B: Command Line
```bash
psql $DATABASE_URL < 02_DATABASE_SCHEMA.sql
```

---

## Step 4: Build ETL Pipeline (Week 1)

### File Structure to Create
```
granted-bio/
├── etl/
│   ├── process_projects.py
│   ├── process_publications.py
│   ├── process_patents.py
│   ├── process_clinical.py
│   ├── generate_embeddings.py
│   ├── classify_projects.py
│   └── load_to_supabase.py
├── app/
│   ├── api/
│   │   ├── search/route.ts
│   │   └── company/[id]/route.ts
│   ├── search/page.tsx
│   └── company/[slug]/page.tsx
└── lib/
    ├── supabase.ts
    ├── openai.ts
    └── classification.ts
```

### Implementation Priority

**Phase 1: Core ETL (Days 1-3)**
1. `etl/process_projects.py` - Parse NIH projects CSV
2. `etl/generate_embeddings.py` - Create vector embeddings
3. `etl/classify_projects.py` - Run 5-tier classification
4. `etl/load_to_supabase.py` - Bulk upload to database

**Phase 2: Multi-Table Processing (Days 4-5)**
5. `etl/process_publications.py` - Parse pubs + classify journals
6. `etl/process_patents.py` - Parse patents + classify types
7. `etl/process_clinical.py` - Parse clinical trials

**Phase 3: Testing (Day 6-7)**
8. Test with 2025 NIH data (user will provide)
9. Validate classification accuracy
10. Verify database integrity

---

## Step 5: Build Search API (Week 2)

### Key Implementation Files

**1. `lib/supabase.ts`**
```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)
```

**2. `app/api/search/route.ts`**
- Implement vector similarity search
- Add keyword filters
- Return ranked results

**3. `lib/classification.ts`**
- Port Python classification to TypeScript
- For real-time reclassification if needed

---

## Step 6: Build Dashboard (Week 3)

### UI Components to Create

**1. Search Interface** (`app/search/page.tsx`)
- Natural language search box
- Filter panel (category, confidence, year)
- Results grid with company cards

**2. Company Detail Page** (`app/company/[slug]/page.tsx`)
- Funding timeline visualization
- Publications list
- Patents list
- Classification signals breakdown

**3. CSV Export**
- Export button on search results
- Generate CSV with all project details

---

## Step 7: Admin Interface (Week 4)

### Admin Pages to Create

**1. Data Upload** (`app/admin/upload/page.tsx`)
- Drag & drop CSV upload
- Schema validation
- Queue processing job

**2. Job Monitor** (`app/admin/status/page.tsx`)
- Real-time job progress
- Processing stats
- Error handling

---

## Key Implementation Notes

### Classification Algorithm
Reference `03_CLASSIFICATION_ALGORITHM.md` for complete logic. Key points:

- **5 tiers of signals** (core, abstract, pubs, patents, clinical)
- **Weighted scoring** (0-100 confidence)
- **Explainable results** (track which signals fired)

Implement in Python first (ETL), then port to TypeScript if needed (API).

### Embeddings Strategy
```python
# Use OpenAI text-embedding-3-small
# 1536 dimensions, ~$0.0001 per 1K tokens

import openai

def generate_embedding(text: str) -> list[float]:
    response = openai.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding
```

Cost: ~$50 for 2025 data (450K embeddings)

### Vector Search
```typescript
// In API route
const { data } = await supabase.rpc('search_projects', {
  query_embedding: queryEmbedding,
  match_threshold: 0.7,
  match_count: 50,
  min_biotools_confidence: 35
})
```

Function defined in `02_DATABASE_SCHEMA.sql`

---

## Testing Checklist

### ETL Pipeline
- [ ] Projects CSV parsed correctly
- [ ] Embeddings generated (1536 dims)
- [ ] Classification produces scores 0-100
- [ ] All 6 tables loaded to Supabase
- [ ] Materialized views created

### Search Functionality
- [ ] Vector search returns relevant results
- [ ] Filters work (category, confidence, year)
- [ ] Response time < 2 seconds
- [ ] Results sorted by confidence

### UI/UX
- [ ] Search interface is intuitive
- [ ] Company pages show full detail
- [ ] CSV export works
- [ ] Mobile responsive

### Admin
- [ ] CSV upload validates schema
- [ ] Processing jobs track progress
- [ ] Errors are logged and displayed

---

## Success Criteria

**Week 1:** 
- ✅ 2025 NIH data loaded into Supabase
- ✅ Classification running with 85%+ accuracy

**Week 2:**
- ✅ Search API functional
- ✅ Returns relevant biotools companies

**Week 3:**
- ✅ Dashboard deployed to granted.bio
- ✅ Search works end-to-end

**Week 4:**
- ✅ Admin upload interface working
- ✅ Ready for pilot users

---

## Getting Help

If you get stuck:

1. **Architecture questions:** Re-read `01_ARCHITECTURE.md`
2. **Schema questions:** Check `02_DATABASE_SCHEMA.sql` comments
3. **Classification logic:** See `03_CLASSIFICATION_ALGORITHM.md` examples
4. **Data format questions:** Ask the user for CSV samples

---

## First Task

**Start here:**

"I've read the documentation for granted.bio. Let's begin by creating the ETL pipeline. First, I'll set up the Python environment and create `etl/process_projects.py` to parse the NIH projects CSV file. 

Can you provide a sample of the 2025 projects CSV so I can test the parser?"

Then implement based on the specifications in the docs.

---

## Important Reminders

1. **Bio boundary filter:** Only load bio/life sciences grants (see 03_CLASSIFICATION_ALGORITHM.md)
2. **Multi-tier classification:** Must implement all 5 tiers for accuracy
3. **Embeddings:** Generate for title + PHR + abstract (3 per project)
4. **Vector indexes:** Use ivfflat for performance
5. **Signal tracking:** Store which signals fired (for explainability)

---

## Ready to Build?

You have everything you need:
- ✅ Complete architecture design
- ✅ Database schema (ready to execute)
- ✅ Classification algorithm (fully specified)
- ✅ 4-week implementation plan

**Let's build granted.bio!** 🚀
