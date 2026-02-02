# granted.bio Platform Planning

## Part 1: Completed Data Infrastructure

### 1.1 Data Assets (Loaded to Supabase)

| Dataset | Records | Coverage | Source | Status |
|---------|---------|----------|--------|--------|
| Projects | 128,847 | FY2024-2025 | NIH RePORTER | ✅ Loaded |
| Abstracts | 128,847 | Linked to projects | NIH RePORTER | ✅ Loaded |
| Publications | 203,020 | Linked to projects | NIH RePORTER | ✅ Loaded |
| Patents | 46,065 | All years | NIH RePORTER | ✅ Loaded |
| Clinical Studies | 38,140 | All years | NIH RePORTER | ✅ Loaded |
| Project-Pub Links | ~500K | FY2024-2025 | NIH RePORTER | ✅ Loaded |

### 1.2 AI Classification (Claude-powered)

All 128,847 projects classified into **Life Science Areas** using Claude (batched via Claude Max):

| Category | Count | % | Description |
|----------|-------|---|-------------|
| therapeutics | 39,197 | 30% | Drug development, biologics, gene therapy |
| other | 54,680 | 42% | Basic research, not product-focused |
| biotools | 22,464 | 17% | Research tools, reagents, instrumentation |
| diagnostics | 9,250 | 7% | Diagnostic tests, biomarkers, imaging |
| medical_device | 1,711 | 1% | Physical devices, implants |
| digital_health | 1,545 | 1% | Software, apps, digital therapeutics |

**Classification Process:**
- Projects batched into 12 files (~5-6K projects each)
- Uploaded to Claude Max (claude.ai) for classification
- Prompt included title, org_name, PHR, and abstract
- Results merged and uploaded to Supabase via `merge_classifications_2024.py`

**Organization Type Classification:**
| Type | Description |
|------|-------------|
| company | INC, LLC, CORP, LTD, PHARMA in name |
| university | UNIVERSITY, COLLEGE, SCHOOL OF in name |
| hospital | HOSPITAL, MEDICAL CENTER, HEALTH SYSTEM |
| research_institute | INSTITUTE, FOUNDATION, or ambiguous |

### 1.3 Vector Embeddings (OpenAI)

All tables have 1536-dimension embeddings using `text-embedding-3-small`:

| Table | Embedding Column | Source Text | Status |
|-------|------------------|-------------|--------|
| projects | project_embedding | title + PHR + terms | ✅ 100% |
| abstracts | abstract_embedding | full abstract text | ✅ 100% |
| publications | publication_embedding | title | ✅ 100% |
| patents | patent_embedding | title | ✅ 100% |
| clinical_studies | clinical_embedding | title | ✅ 100% |

**Embedding Cost:** ~$50 total for all 450K embeddings

**Vector Indexes:** IVFFlat indexes on all embedding columns for fast similarity search

### 1.4 Email Extraction

Extracted PI emails from publication author affiliations:

| Metric | Value |
|--------|-------|
| Total Emails | 27,162 |
| Coverage | 13.4% of publications |
| Source | Corresponding author affiliations |
| Quality | Verified academic/institutional emails |

### 1.5 Search Capabilities Built

**Semantic Vector Search (via pgvector)**
- Natural language queries converted to embeddings
- Cosine similarity search across all tables
- Function: `search_projects(query_embedding, match_threshold, match_count)`

**Structured Filters**
- Fiscal year (2024, 2025)
- Primary category (biotools, therapeutics, diagnostics, etc.)
- Organization type (university, company, hospital, research_institute)
- Organization state/location
- Funding range (total_cost)
- Activity code (R01, SBIR, etc.)
- SBIR/STTR only toggle

**Cross-linking**
- Projects → Publications (via project_number)
- Projects → Patents (via project_number)
- Projects → Clinical Studies (via project_number)

### 1.6 Unique Data Points (Competitive Advantage)

| Data Point | Value | NIH Reporter Has? |
|------------|-------|-------------------|
| Life Science Area classification | 6 categories | ❌ No |
| Semantic search | Natural language | ❌ No (keyword only) |
| PI emails | 27K verified | ❌ No |
| Patent + publication counts per project | Aggregated | ❌ Manual only |
| Commercialization signals | SBIR phase, patents, trials | ❌ Scattered |
| Methods vs therapeutic journal classification | Per publication | ❌ No |

### 1.7 Database Schema

```
projects (128K rows)
├── application_id (PK)
├── project_number, fiscal_year, title, phr
├── org_name, org_city, org_state, org_type
├── pi_names, total_cost, activity_code
├── primary_category, project_embedding
└── is_sbir, is_sttr, is_supplement

abstracts (128K rows)
├── application_id (PK, FK → projects)
├── abstract_text, abstract_embedding
└── updated_at

publications (203K rows)
├── pmid (PK)
├── title, journal, pub_year
├── is_methods_journal, is_therapeutic_journal
├── author_email, publication_embedding
└── created_at

patents (46K rows)
├── patent_id (PK)
├── project_number (FK), patent_title
├── patent_embedding
└── created_at

clinical_studies (38K rows)
├── nct_id (PK)
├── project_number (FK), title, phase
├── clinical_embedding
└── created_at

project_publications (500K rows)
├── project_number, pmid
└── (junction table)
```

### 1.8 ETL Scripts Created

| Script | Purpose |
|--------|---------|
| `load_to_supabase.py` | Main ETL: load all tables from CSV |
| `process_projects.py` | Parse NIH projects CSV, bio-filter |
| `process_publications.py` | Parse pubs CSV, classify journals |
| `generate_embeddings.py` | Generate project embeddings |
| `generate_publication_embeddings.py` | Generate pub embeddings |
| `generate_patent_embeddings.py` | Generate patent embeddings |
| `generate_clinical_embeddings.py` | Generate clinical embeddings |
| `classify_projects_batched.py` | Prepare batches for Claude classification |
| `merge_classifications_2024.py` | Merge classified batches, update DB |
| `extract_emails.py` | Extract PI emails from publications |
| `data_audit.py` | Verify data completeness |

---

## Part 2: User Personas

### Persona 1: Researchers (Competitive Intelligence)

**Who:** Academic researchers, postdocs, PIs writing grants

**Value Prop:** "Win grants by knowing your competition"

**Jobs to be Done:**
- "Who got funded in my area?" - competitive landscape before writing R01
- "Is my idea novel?" - validate differentiation for grant applications
- "Who's working on similar tech?" - find collaborators or competitors
- "What patents exist?" - avoid IP landmines
- "What's trending?" - see what NIH is actually funding

**Key Insight:** Researchers need intelligence to *write better grants*, not to find them.

**Features:**

| Feature | Use Case |
|---------|----------|
| Competitive Landscape | "Show me everyone funded in spatial transcriptomics last 2 years" |
| Novelty Check | "Is anyone doing [my specific approach]?" via semantic search |
| Patent Scan | "Patents in my research area that might block me" |
| Funding Trends | "What's NIH actually funding in [area]?" |
| Collaborator Discovery | "Who has complementary expertise + funding?" |

---

### Persona 2: BD Teams (Sales/Partnerships)

**Who:** Sales reps at reagent companies, instrument vendors, CROs, CDMOs; BD teams at biotech/pharma

**Value Prop:** "Find funded companies to sell to"

**Jobs to be Done:**
- Find companies working on [technology X] to sell to
- Build qualified lead lists for sales campaigns
- Research prospects before outreach
- Track competitors' funding

**Pain Points:**
- Lead lists are expensive (ZoomInfo, etc.)
- Generic leads aren't qualified by technology area
- No way to filter by "biotools companies" vs therapeutic companies
- Contact info is scattered

**Features:**

| Feature | Description |
|---------|-------------|
| Lead List Builder | Filter: biotools + SBIR + proteomics + >$500K funding |
| Contact Export | Company, PI name, email (from publications), location |
| Company Intelligence | All grants, patents, publications for a company |

**Email Disclosure:** Emails available from publication affiliations. Preview shows exact count before purchase (e.g., "12 of 47 companies have verified emails"). Small but hyper-targeted = high value.

---

### Persona 3: Investors (Due Diligence)

**Who:** VCs, family offices, corporate venture arms evaluating life science companies

**Value Prop:** "Diligence + deal sourcing from grant data"

**Jobs to be Done:**
- Evaluate a company's funding history and trajectory
- Map competitive landscape for a market segment
- Identify emerging players (recent SBIR Phase I)
- Validate technical claims during diligence

**Features:**

| Feature | Description |
|---------|-------------|
| Company Deep Dive | Full grant history, patents, publications, clinical trials |
| Market Map | All companies in [technology segment] with competitive matrix |
| Competitive Analysis | Target company vs. 5-10 competitors side-by-side |
| Funding Trajectory | Visualize grant progression over time |

---

## Part 3: Platform Vision - Hybrid AI Search System

### 3.1 Core Concept

**Problem:** Traditional filter-based search becomes a maze when datasets have many dimensions.

**Solution:** Natural language, conversational AI search agent that:
1. Interprets user intent from natural language queries
2. Asks clarifying questions when needed
3. Executes structured queries behind the scenes
4. Offers customizable output formats

### 3.2 Query Flow Architecture

```
Simple Query Path:
"CRISPR therapeutics" → Vector search → Results

Complex Query Path:
User: "I need companies working on gene therapy delivery"
   ↓
AI Agent: "Got it. A few questions to narrow this down:
           - Any specific disease area? (CNS, oncology, rare disease...)
           - Funding stage preference? (early R01 vs late-stage SBIR)
           - Geographic focus?"
   ↓
User: "CNS, any stage, US only"
   ↓
AI Agent: [Builds structured query, executes, returns results]
```

### 3.3 Token Optimization Strategy

| Model | Use Case | Cost |
|-------|----------|------|
| Haiku | Intent classification, simple parsing | ~$0.0001/query |
| Vector Search | Semantic retrieval (embeddings pre-computed) | ~$0 |
| Sonnet | Complex reasoning, report generation | ~$0.003/query |
| Opus | Enterprise reports, deep analysis | ~$0.015/query |

### 3.4 Tiered Access Model

| Tier | AI Usage | Output |
|------|----------|--------|
| Free | 5 AI queries/day, Haiku only | Top 10 results, no export |
| Pro | Unlimited, Sonnet | Full results, CSV export, saved searches |
| Enterprise | Opus, custom reports | API access, alerts, CRM integration |

---

## Part 4: Report Products (Premium)

The core premium product: **AI-generated intelligence reports** that synthesize across all data sources. NIH Reporter is just a database; granted.bio sells analysis.

### 4.1 Researcher Report: "Competitive Landscape"

**Use Case:** PI writing an R01, needs to understand the funded landscape

**Report Contents:**
- Executive summary of funding in [topic area]
- List of funded projects (semantic match via embeddings)
- Key players: PIs, institutions, companies
- Patent landscape (potential IP blockers)
- Publication trends (methods papers = tools being developed)
- Funding trends by year
- **"White space" analysis** - what's NOT being funded (differentiation opportunity)

**Price:** $49-99 per report

---

### 4.2 BD Report: "Prospecting List"

**Use Case:** Sales rep needs qualified leads in a technology segment

**Report Contents:**
- Company list matching criteria (technology area, funding level, org type)
- For each company:
  - Company name, location
  - PI name(s)
  - Total NIH funding
  - Technology focus (from classification + abstract)
  - Patent count (indicates commercialization)
  - Contact email (where available from publications)

**Pre-Purchase Transparency:**
```
┌─────────────────────────────────────────────┐
│  Your Report Preview                        │
│                                             │
│  Companies matching criteria:    47         │
│  PI names available:            47 (100%)   │
│  Verified emails available:     12 (26%)    │
│                                             │
│  ⚠️ Email coverage is below 50%.            │
│  Emails are from publication affiliations   │
│  (corresponding authors).                   │
│                                             │
│  [Purchase Report - $149]                   │
└─────────────────────────────────────────────┘
```

**Price:**
- $99 for <25 companies
- $149 for 25-100 companies
- $299 for 100+ companies

**Key insight:** 12 verified emails of corresponding authors working on exactly what you sell is worth more than 1000 scraped emails from a generic database.

---

### 4.3 Investor Report: "Due Diligence Package"

**Use Case:** VC evaluating a company or mapping a market

**Report Types:**

**A. Company Deep Dive ($149)**
- All NIH grants (full history if available)
- Funding trajectory chart
- Patent portfolio with titles
- Publication record (total + methods papers)
- Clinical trials (if any)
- Classification: Is this a biotools company? Therapeutics?
- PI/founder background (other grants?)

**B. Market Map ($299)**
- All companies in [technology segment]
- Competitive matrix (funding, patents, publications, trials)
- Technology clusters (via embeddings)
- Funding trends
- Top players by funding amount
- Emerging players (recent SBIR Phase I)

**C. Competitive Analysis ($199)**
- Target company vs. 5-10 competitors
- Side-by-side comparison
- Differentiation analysis

---

## Part 5: AI Agent Architecture

### 5.1 Persona-First Approach

Users select their persona on the homepage, which loads a persona-specific AI agent with tailored:
- System prompt and context
- Conversation flow and questions
- Output formats and report types
- Pricing/access tier

```
┌────────────────────────────────────────────────┐
│                 granted.bio                     │
│       Life Science Grant Intelligence          │
│                                                │
│         What brings you here today?            │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │    🔬    │  │    📈    │  │    💰    │     │
│  │Researcher│  │    BD    │  │ Investor │     │
│  │          │  │          │  │          │     │
│  │ "Who's   │  │ "Find    │  │"Evaluate │     │
│  │  funded  │  │companies │  │ company  │     │
│  │  in my   │  │ to sell  │  │or map a  │     │
│  │  area?"  │  │   to"    │  │ market"  │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│                                                │
└────────────────────────────────────────────────┘
```

### 5.2 Agent 1: Researcher Agent

**Purpose:** Help researchers understand competitive landscape for grant writing

**System Prompt:**
```
You are a research intelligence assistant for granted.bio, helping academic researchers
understand the competitive landscape of NIH-funded research.

YOUR USER: Academic researchers, postdocs, PIs preparing grant applications
THEIR GOAL: Understand who's funded in their area, validate novelty, find collaborators,
identify IP risks - NOT to find grants to apply for (that's NIH Reporter/Grants.gov)

DATABASE ACCESS:
- 128,847 NIH projects (FY2024-2025) with semantic embeddings
- 203,020 linked publications
- 46,065 patents
- 38,140 clinical studies
- Life Science classifications: biotools, therapeutics, diagnostics, medical_device, digital_health, other

AVAILABLE FILTERS:
- Semantic search (natural language → vector similarity)
- Life Science Area (our unique classification)
- Organization type: company, university, hospital, research_institute
- Fiscal year: 2024, 2025
- State/location
- Funding amount (total_cost)
- Activity code (R01, SBIR, K-series, etc.)
- SBIR/STTR only toggle

CONVERSATION FLOW:
1. Ask about their research area/technology focus
2. Clarify if looking for: competitors, collaborators, or general landscape
3. Ask about timeframe and any specific filters
4. Execute search and present results
5. Offer follow-up: similar research, patent scan, or full report

KEY QUESTIONS TO ASK:
- "What research area or technology are you exploring?"
- "Are you scoping competitors, looking for collaborators, or mapping the field?"
- "Any specific disease area or application?"
- "Do you want to include patents in the search?"
- "Recent funding only (2024-2025) or all available years?"

OUTPUT TYPES:
- Search results list (title, org, PI, funding, category)
- Similar research finder ("find more like this")
- Patent landscape summary
- Competitive Landscape Report (premium)

TONE: Academic, precise, helpful. Use research terminology.

LIMITS:
- Free users: 25 results shown, no export, no emails
- Pro users: Full results, export, similar research, patent view
- Keep conversations to 3-5 turns before presenting results
```

**Example Conversation:**
```
User: "I'm writing an R01 on spatial transcriptomics for neurodegenerative disease"

Agent: "I can help you understand the competitive landscape. Are you looking to:
        1. See who's already funded in this space (competitors)
        2. Find potential collaborators with complementary expertise
        3. Check if your specific approach is novel

        Also, do you want me to include a patent scan for potential IP issues?"

User: "Competitors mainly, and yes include patents"

Agent: "Found 47 projects matching 'spatial transcriptomics neurodegenerative':
        - 31 at universities, 8 at research institutes, 8 at companies
        - Top funded: [list]
        - Also found 12 related patents

        Want to:
        - See the full list with abstracts
        - Find similar research to any of these
        - Generate a Competitive Landscape Report ($49)"
```

---

### 5.3 Agent 2: BD Agent

**Purpose:** Help sales/BD teams find companies and build qualified lead lists

**System Prompt:**
```
You are a sales intelligence assistant for granted.bio, helping life science sales and
BD professionals find companies to sell to or partner with.

YOUR USER: Sales reps at reagent companies, instrument vendors, CROs, CDMOs;
BD teams at biotech/pharma looking for partnerships or acquisitions
THEIR GOAL: Build qualified lead lists of funded companies, research prospects,
find contact information

DATABASE ACCESS:
- 128,847 NIH projects (FY2024-2025) with semantic embeddings
- 27,162 PI emails (from publication affiliations)
- 46,065 patents (indicates commercialization intent)
- 38,140 clinical studies (indicates late-stage development)
- Life Science classifications: biotools, therapeutics, diagnostics, medical_device, digital_health, other

AVAILABLE FILTERS:
- Semantic search (natural language → vector similarity)
- Organization type: company, university, hospital, research_institute
- Life Science Area (biotools = research tools, therapeutics = drugs, etc.)
- SBIR/STTR only (more commercially focused)
- Funding amount minimum/maximum
- State/location
- Activity code

CONVERSATION FLOW:
1. Ask what they sell or what technology they're looking for
2. Clarify organization type preference (companies only? include universities?)
3. Ask about funding/stage filters (SBIR = commercial, R01 = academic)
4. Ask about geography if relevant
5. Execute search and show preview
6. Offer export with contact information (paid)

KEY QUESTIONS TO ASK:
- "What do you sell, or what technology/application are you looking for?"
- "Companies only, or also universities/hospitals?"
- "Any minimum funding threshold? (Higher funding = bigger budget)"
- "SBIR/STTR only? (More commercially focused)"
- "Any geographic focus?"

OUTPUT TYPES:
- Company/org list (name, location, PI, funding, tech focus)
- Company Intelligence (all grants, patents, pubs for one org)
- Lead List Export with contacts (premium)
- Prospecting Report (premium)

EMAIL DISCLOSURE:
- Always show email availability count BEFORE purchase
- Format: "47 companies found, 12 have verified PI emails (26%)"
- Emails are from publication corresponding authors - high quality but limited coverage

TONE: Business-focused, ROI-oriented. Speak in sales/BD terminology.

LIMITS:
- Free users: 25 results, no export, no emails shown
- Pro users: Full results, export, emails visible, company intelligence
- Keep conversations to 3-5 turns before presenting results
```

**Example Conversation:**
```
User: "I sell mass spec instruments and need proteomics companies to target"

Agent: "I'll help you find proteomics companies with NIH funding. A few questions:
        1. Companies only, or also include academic labs? (Academic = larger volume but longer sales cycles)
        2. Any minimum funding level? (e.g., >$500K indicates serious research budget)
        3. SBIR/STTR only? (These are more commercially focused)"

User: "Companies and well-funded academic labs, over $500K, any grant type"

Agent: "Found 83 organizations with proteomics grants >$500K:
        - 34 companies
        - 49 university labs

        Email availability: 19 verified PI emails (23%)

        Preview (first 10):
        [list with org name, PI, location, funding, tech focus]

        Want to:
        - See company intelligence for any specific org
        - Export full list with contacts ($149)
        - Refine search further"
```

---

### 5.4 Agent 3: Investor Agent

**Purpose:** Help VCs and investors with due diligence and market mapping

**System Prompt:**
```
You are an investment intelligence assistant for granted.bio, helping life science
investors with due diligence and market analysis.

YOUR USER: VCs, corporate venture, family offices, PE firms evaluating life science companies
THEIR GOAL: Due diligence on specific companies, market mapping for investment thesis,
deal sourcing for emerging players

DATABASE ACCESS:
- 128,847 NIH projects (FY2024-2025) with semantic embeddings
- 46,065 patents (IP portfolio indicator)
- 203,020 publications (validation of science)
- 38,140 clinical studies (regulatory progress)
- Life Science classifications: biotools, therapeutics, diagnostics, medical_device, digital_health, other
- Funding trajectories over time

AVAILABLE FILTERS:
- Semantic search (natural language → vector similarity)
- Organization type: company, university, hospital, research_institute
- Life Science Area
- SBIR Phase I (early) vs Phase II (later stage)
- Funding amount
- State/location
- Activity code

CONVERSATION FLOW:
1. Ask if they're evaluating a specific company OR mapping a market
2. For company: get company name, run deep dive
3. For market: get technology/thesis area, clarify stage preference
4. Present findings with investment-relevant metrics
5. Offer competitive analysis or full report

KEY QUESTIONS TO ASK:
- "Are you evaluating a specific company, or mapping a market/thesis?"
- FOR COMPANY: "What's the company name? I'll pull their full NIH history."
- FOR MARKET: "What technology area or investment thesis?"
- "Stage preference? (SBIR Phase I = early, Phase II = more validated)"
- "Want to see competitors or the full landscape?"

OUTPUT TYPES:
- Company Deep Dive (all grants, patents, pubs, trials, trajectory)
- Market Map (all players in a segment with competitive matrix)
- Competitive Analysis (target vs. comparables)
- Emerging Players list (recent SBIR Phase I in segment)
- Due Diligence Report (premium)

METRICS TO HIGHLIGHT:
- Total NIH funding (validation of science)
- Patent count (IP protection)
- Publication count (scientific credibility)
- Clinical trials (regulatory progress)
- Funding trajectory (growth signal)
- SBIR phase progression (commercialization progress)

TONE: Investment-focused, analytical. Speak in VC/diligence terminology.

LIMITS:
- Free users: Basic search, limited company info
- Pro users: Full deep dives, market maps, export
- Keep conversations to 3-5 turns before presenting results
```

**Example Conversation:**
```
User: "I'm looking at a company called Acme Genomics for a Series A"

Agent: "I'll pull the full profile for Acme Genomics.

        **Acme Genomics - NIH Funding Profile**

        Total NIH Funding: $4.2M across 6 grants
        - SBIR Phase I: 2 grants ($500K) - 2022
        - SBIR Phase II: 1 grant ($1.5M) - 2023
        - R01: 1 grant ($1.2M) - 2024 (academic collaboration)

        Classification: Biotools (genomics instrumentation)

        IP: 4 patents on file
        Publications: 12 linked papers (8 in methods journals)
        Clinical Trials: None

        **Funding Trajectory:** Growing - progressed from Phase I to Phase II

        Want me to:
        - Show their competitors in genomics biotools
        - Compare them side-by-side with 3-5 competitors
        - Generate a full Due Diligence Report ($149)"

User: "Show competitors"

Agent: "Found 23 companies in genomics/biotools with similar NIH funding:

        Top 5 by funding:
        1. GeneTech Inc - $8.1M (Phase II + R01)
        2. SeqTools LLC - $5.3M (Phase II)
        3. Acme Genomics - $4.2M (your target)
        4. OmicsLab - $3.8M (Phase I only)
        5. NextGen Seq - $2.9M (Phase II)

        Want a side-by-side Competitive Analysis ($199)?"
```

---

## Part 6: Free vs Paid Access

### 6.1 Access Tiers by Feature

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Searches per month | 10 | Unlimited | Unlimited |
| Results shown | 25 | All | All |
| Result detail | Basic (title, org, funding) | Full (+ abstract, PI) | Full |
| PI emails visible | ❌ | ✅ | ✅ |
| Export to CSV | ❌ | ✅ | ✅ |
| Similar research | ❌ | ✅ | ✅ |
| Company/PI profiles | Limited | Full | Full |
| Saved searches | ❌ | ✅ | ✅ |
| Reports | Purchase only | Credits included | Unlimited |
| API access | ❌ | ❌ | ✅ |
| AI conversation depth | 2-3 turns | Full | Full |

### 6.2 Pricing by Persona

| Tier | Target | Price | Includes |
|------|--------|-------|----------|
| **Free** | All | $0 | 10 searches/mo, 25 results, basic info |
| **Researcher Pro** | Academics | $29/mo | Unlimited search, export, similar research, 2 reports/mo |
| **Lab** | Research Groups | $99/mo | 5 seats, shared searches, 5 reports/mo |
| **BD Pro** | Sales Teams | $149/mo | Lead lists, contacts, company intel, 5 reports/mo |
| **Investor Pro** | VCs | $199/mo | Deep dives, market maps, 10 reports/mo |
| **Institution** | Universities | $5K-20K/yr | Unlimited seats, API, unlimited reports |
| **Enterprise** | Large Teams | Custom | API, CRM integration, dedicated support |

### 6.3 Report Pricing (à la carte)

| Report | Price | Contents |
|--------|-------|----------|
| Competitive Landscape | $49-99 | Funded projects, key players, trends, white space |
| Prospecting List | $99-299 | Companies + contacts (price by count) |
| Company Deep Dive | $149 | Full history, patents, pubs, trials |
| Market Map | $299 | Segment analysis, competitive matrix |
| Competitive Analysis | $199 | Target vs. 5-10 competitors |

---

## Part 7: Technical Architecture

### 7.1 Agent Implementation

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Persona Selection Page                   │  │
│  │  [Researcher]    [BD]    [Investor]                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Chat Interface                           │  │
│  │  - Message history                                    │  │
│  │  - Streaming responses                                │  │
│  │  - Result cards                                       │  │
│  │  - Export/Report buttons                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Routes                              │
│  POST /api/chat                                              │
│  ├── Load persona-specific system prompt                    │
│  ├── Check user tier (free/pro/enterprise)                  │
│  ├── Call Claude API with tools                             │
│  └── Stream response to frontend                            │
│                                                              │
│  Agent Tools (function calling):                            │
│  ├── search_projects(query, filters) → vector search       │
│  ├── get_company_profile(org_name) → aggregate data        │
│  ├── get_pi_profile(pi_name) → aggregate data              │
│  ├── find_similar(project_id) → vector similarity          │
│  ├── search_patents(query) → patent search                 │
│  └── generate_report(type, params) → PDF generation        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  projects  │  │   patents  │  │   users    │            │
│  │ + vectors  │  │ + vectors  │  │ + tiers    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │publications│  │  clinical  │  │  searches  │            │
│  │ + vectors  │  │ + vectors  │  │  (saved)   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Model Selection

| Use Case | Model | Est. Cost |
|----------|-------|-----------|
| Chat conversation | Claude 3.5 Haiku | ~$0.001/conversation |
| Report generation | Claude 3.5 Sonnet | ~$0.01/report |
| Complex analysis | Claude 3 Opus | ~$0.05/report |

### 7.3 Tool Definitions

```typescript
// Agent tools for function calling
const tools = [
  {
    name: "search_projects",
    description: "Search NIH projects using semantic similarity and filters",
    parameters: {
      query: "string - natural language search query",
      filters: {
        fiscal_year: "array of years",
        primary_category: "biotools|therapeutics|diagnostics|...",
        org_type: "company|university|hospital|research_institute",
        is_sbir: "boolean",
        is_sttr: "boolean",
        min_funding: "number",
        max_funding: "number",
        state: "string - 2 letter state code"
      },
      limit: "number - max results (enforced by user tier)"
    }
  },
  {
    name: "get_company_profile",
    description: "Get aggregated profile for an organization",
    parameters: {
      org_name: "string - organization name to look up"
    }
  },
  {
    name: "get_pi_profile",
    description: "Get aggregated profile for a PI",
    parameters: {
      pi_name: "string - PI name to look up"
    }
  },
  {
    name: "find_similar",
    description: "Find projects similar to a given project",
    parameters: {
      project_id: "string - application_id of source project",
      limit: "number - how many similar projects"
    }
  },
  {
    name: "search_patents",
    description: "Search patents by technology area",
    parameters: {
      query: "string - technology or keyword to search"
    }
  }
]
```

---

## Part 8: Implementation Roadmap

### Phase 1: Core Agent (MVP)
- [ ] Persona selection page
- [ ] Chat interface with streaming
- [ ] Researcher agent with search_projects tool
- [ ] Basic result display
- [ ] User auth (Supabase)

### Phase 2: All Personas + Profiles
- [ ] BD agent with company focus
- [ ] Investor agent with deep dive focus
- [ ] Company profile page
- [ ] PI profile page
- [ ] Export to CSV

### Phase 3: Monetization
- [ ] Stripe integration
- [ ] Tier enforcement (free/pro/enterprise)
- [ ] Report generation (PDF)
- [ ] Email visibility by tier

### Phase 4: Advanced Features
- [ ] Saved searches
- [ ] Alerts (email on new matches)
- [ ] API access for enterprise
- [ ] CRM integration

---

## Part 9: Current Implementation Status (February 2026)

### 9.1 What's Built

| Component | Status | Location |
|-----------|--------|----------|
| Persona selection UI | ✅ Done | `/src/app/page.tsx` |
| Chat interface | ✅ Done | `/src/components/chat/` |
| Chat API route | ✅ Done | `/src/app/api/chat/route.ts` |
| Agent tools | ✅ Done | `/src/lib/chat/tools.ts` |
| Persona prompts | ✅ Done | `/src/lib/chat/prompts.ts` |
| User auth (Supabase) | ✅ Done | `/src/lib/supabase-server.ts` |
| Vector search function | ✅ Done | `search_projects_filtered()` in DB |
| Database indexes | ✅ Done | B-tree, GIN, composite indexes |

### 9.2 Agent Architecture (Implemented)

**Model:** Claude 3.5 Haiku (`claude-3-5-haiku-20241022`)

**Tool Loop:**
- Max 5 iterations per user message
- Each iteration = 1 Anthropic API call
- Typical query uses 1-3 iterations

**Available Tools:**
| Tool | Purpose |
|------|---------|
| `search_projects` | Semantic vector search with filters |
| `get_company_profile` | Aggregate org data (grants, patents, pubs) |
| `get_pi_profile` | Aggregate PI data |
| `find_similar` | Vector similarity to find related projects |
| `search_patents` | Patent search by technology |

### 9.3 Current Limits & Settings

| Setting | Value | Location |
|---------|-------|----------|
| Match threshold | 0.5 | `tools.ts:180` |
| Results per search (chat) | 15 | `tools.ts:171` |
| Max tool iterations | 5 | `route.ts:84` |
| Free tier searches | 10 | `route.ts:24` |
| Free tier results limit | 25 | `route.ts:20` |
| Pro tier results limit | 100 | `route.ts:30` |

### 9.4 Database Optimizations Applied

**Migrations:**
- `015_database_optimization.sql` - B-tree, GIN, composite indexes
- `017_filter_states_array.sql` - Multi-state filtering support

**Indexes Created:**
- B-tree: fiscal_year, org_state, org_type, primary_category, total_cost, funding_mechanism
- GIN (trigram): org_name, pi_names, title
- Composite: (fiscal_year, org_state) WHERE is_bio_related
- Vector: IVFFlat on abstract_embedding (lists=100)

**HNSW Index:** Not created - times out on Supabase. Would need support ticket for manual creation.

### 9.5 Known Issues & Fixes Applied

| Issue | Status | Fix |
|-------|--------|-----|
| Intermediate text showing ("I'll search...") | ✅ Fixed | Only stream text when no tool calls |
| State filter single value only | ✅ Fixed | Changed to array, updated SQL function |
| Low result counts with filters | ⚠️ Partial | Threshold at 0.5 may be too strict |
| IVFFlat index dropped | ✅ Fixed | Recreated with lists=100 |

### 9.6 Cost Structure (Per User Message)

| Cost Driver | Estimate |
|-------------|----------|
| Haiku API (1-5 calls) | $0.001-0.005 |
| OpenAI embedding | $0.00002 |
| Supabase DB | ~$0 (included) |
| **Total per message** | **~$0.001-0.005** |

**Monthly estimate at scale:**
- 1000 users × 20 messages/mo = 20K messages
- Cost: $20-100/month in API calls

### 9.7 Pending Decisions

1. **Search threshold** - Lower from 0.5 to 0.35 for more results?
2. **Tool iterations** - Reduce from 5 to 3 to cap costs?
3. **Result caps** - Increase from 15 for pro users?
4. **Free tier limits** - Currently 10 searches, 25 results
5. **Pricing implementation** - Stripe not yet integrated

### 9.8 Updated Roadmap

**Phase 1: Core Agent (MVP)** ✅ COMPLETE
- [x] Persona selection page
- [x] Chat interface with streaming
- [x] All three agents (Researcher, BD, Investor)
- [x] Basic result display
- [x] User auth (Supabase)

**Phase 2: Optimization & Quality** 🔄 IN PROGRESS
- [x] Database indexes for performance
- [x] Fix intermediate text streaming
- [x] Multi-state filtering
- [ ] Tune search threshold for better recall
- [ ] Add logging for cost monitoring
- [ ] Test and validate search quality

**Phase 3: Monetization** ⏳ NOT STARTED
- [ ] Stripe integration
- [ ] Tier enforcement (free/pro/enterprise)
- [ ] Report generation (PDF)
- [ ] Email visibility by tier

**Phase 4: Advanced Features** ⏳ NOT STARTED
- [ ] Saved searches
- [ ] Alerts (email on new matches)
- [ ] API access for enterprise
- [ ] CRM integration
