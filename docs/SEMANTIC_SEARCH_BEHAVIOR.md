# Semantic Search Behavior & Trade-offs

**Document:** Search System Technical Notes
**Last Updated:** March 5, 2026
**Status:** Active

---

## Overview

granted.bio uses semantic (embedding-based) search rather than keyword search. This document explains how it works, its trade-offs, and why certain behaviors exist.

---

## How Semantic Search Works

### Embedding Generation
1. User query is converted to a 1536-dimensional vector using OpenAI's `text-embedding-3-small` model
2. This vector represents the *meaning* of the query in embedding space
3. Projects have pre-computed embeddings from their abstracts stored in the database

### Vector Similarity Search
1. PostgreSQL's pgvector extension finds projects whose embeddings are closest to the query embedding
2. Uses cosine distance: `1 - (embedding <=> query_embedding)` = similarity score (0-1)
3. Returns results ordered by similarity

### HNSW Index
- We use HNSW (Hierarchical Navigable Small World) index for fast approximate nearest neighbor search
- Index parameter: `ef_search = 200` (controls recall vs speed trade-off)
- This means the index explores ~200 candidates per search

---

## Key Behavior: Broad Queries Return Fewer Results

### The Phenomenon
| Query | NIH RePORTER | granted.bio |
|-------|--------------|-------------|
| "cancer" | 24,000+ | ~68 |
| "CAR-T cell therapy" | ~500 | ~144 |
| "neural organoid platforms for brain disease" | ~50 | ~150 |

### Why This Happens

1. **HNSW Index Limitation**
   With `ef_search = 200`, the index only explores 200 candidates. For a generic term like "cancer", thousands of projects have similar embeddings, but we only retrieve the top ~200.

2. **Deduplication**
   Same project across multiple fiscal years → deduplicated to most recent year. This can reduce 200 results to ~68 unique projects.

3. **Embedding Space Clustering**
   "Cancer" as a concept maps to a specific region in embedding space. Projects mentioning cancer in different contexts (treatments, diagnostics, basic research) spread across this region. We find the closest ~200 to the centroid.

### This Is By Design

Semantic search is optimized for **precision**, not **recall**:
- ✅ Excellent at: "CAR-T therapy for pediatric B-cell leukemia" → finds conceptually relevant projects
- ✅ Excellent at: Finding projects that discuss a concept without using exact keywords
- ❌ Not designed for: "Show me all cancer projects" → use keyword search for exhaustive results

---

## Precision Filter (Match Quality)

### Percentile-Based Filtering
Since similarity scores cluster tightly (often 0.50-0.70 for good matches), we use percentile-based filtering instead of fixed thresholds:

| Level | Percentile | Example (144 results) |
|-------|------------|----------------------|
| Broad | 100% | 144 |
| Balanced | Top 50% | 72 |
| Precise | Top 20% | 29 |

### Why Percentiles?
Fixed thresholds (e.g., >0.50, >0.60, >0.70) failed when similarity scores clustered. With all results having similarity 0.60-0.70, a 0.50 threshold showed all results and 0.70 showed almost none.

Percentiles always create meaningful differentiation regardless of score distribution.

---

## Configuration Parameters

### Database (Supabase)
```sql
-- In search_projects_filtered function
SET LOCAL hnsw.ef_search = 200;  -- Index exploration depth
match_threshold = 0.15;          -- Minimum similarity (very low to maximize recall)
match_count = 1000;              -- Max results requested
```

### Application (tools.ts)
```typescript
// Semantic search threshold
const threshold = 0.15  // Very low - relies on precision filter for quality control

// Results limit
const effectiveLimit = Math.min(limit, userAccess.resultsLimit)
// Requests effectiveLimit * 10 from RPC, deduplicates to ~effectiveLimit
```

---

## Potential Improvements

### If More Results Needed for Broad Queries

1. **Increase ef_search** (e.g., 500 or 1000)
   - Pros: More results for broad queries
   - Cons: Slower ALL queries, diminishing returns

2. **Hybrid Search for Generic Terms**
   - Detect short/generic queries (< 3 words, common terms)
   - Fall back to keyword search for exhaustive results
   - Keep semantic search for specific queries

3. **Multiple Embedding Queries**
   - For "cancer", generate variations: "cancer research", "cancer treatment", "cancer diagnosis"
   - Union results from multiple searches

### Current Decision
Accept current behavior. Semantic search returns the TOP semantically similar results, not ALL matching results. Users seeking exhaustive results should use NIH RePORTER directly.

---

## Comparison: Semantic vs Keyword Search

| Aspect | Semantic Search | Keyword Search |
|--------|-----------------|----------------|
| Query | "neural organoids for modeling brain diseases" | "organoid" AND "brain" |
| Finds | Conceptually related projects | Exact keyword matches |
| Recall | Limited (~100-200 results) | Exhaustive (all matches) |
| Precision | High (top results very relevant) | Variable (includes tangential matches) |
| Speed | Fast (~200ms) | Slower for broad terms (can timeout) |
| Synonyms | Automatic (embedding captures meaning) | Manual (need pipe-separated synonyms) |

---

## Debugging Search Issues

### Check Similarity Distribution
```python
# In etl/diagnose_search.py
# Shows similarity score distribution for a query
python diagnose_search.py
```

### Check Index Configuration
```sql
-- In Supabase SQL Editor
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'projects';
SHOW hnsw.ef_search;
```

### Verify Embedding Coverage
```sql
-- Count projects with embeddings
SELECT
  COUNT(*) as total,
  COUNT(abstract_embedding) as with_embedding
FROM projects
WHERE is_bio_related = true;
```

---

## Search Function Reference

### Complete Trace (src/lib/chat/tools.ts)

The following search functions exist in the codebase. Only those marked **ACTIVE** are currently used by the tool dispatcher.

#### 1. keywordSearch (line 368)
**Status:** Available but NOT used by dispatcher
```typescript
export async function keywordSearch(
  params: KeywordSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult>
```
- **Purpose:** Pure keyword search using word-by-word AND logic
- **Data sources:** `abstracts` table (abstract_text), `projects` table (terms field)
- **Logic:** Searches for each word in query, intersects results (AND), unions abstract/term matches (OR)
- **Features:** Automatic singular/plural variation handling
- **Returns:** KeywordSearchResult with all_results, by_category, by_org_type

#### 2. searchProjects (line 633)
**Status:** Available but NOT used by dispatcher
```typescript
export async function searchProjects(
  params: SearchProjectsParams,
  userAccess: UserAccess
): Promise<{ results: ProjectResult[], total: number }>
```
- **Purpose:** Basic semantic search with filters (chat context optimized)
- **RPC:** `search_projects_filtered`
- **Limits:** Capped at 15 results for chat token management
- **Features:** SQL-level filtering for performance, JS fallback for SBIR/STTR

#### 3. searchProjectsHybrid (line 784)
**Status:** Available but NOT used by dispatcher
```typescript
export async function searchProjectsHybrid(
  params: HybridSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult>
```
- **Purpose:** Combines keyword + semantic search using RRF scoring
- **Algorithm:** Reciprocal Rank Fusion (RRF) with K=60
- **Formula:** `score = sum(1 / (K + rank))`
- **Semantic boost:** Multiplies semantic score by `(1 + similarity)`
- **Features:** Deduplicates by project_number, keeps most recent fiscal year

#### 4. searchProjectsSemantic (line 1015) **ACTIVE**
**Status:** **Used by `executeTool` for `search_projects` tool**
```typescript
export async function searchProjectsSemantic(
  params: HybridSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult>
```
- **Purpose:** Semantic-only search with similarity scores for client-side precision filtering
- **RPC:** `search_projects_filtered` via `getSemanticResults` helper
- **Threshold:** 0.15 (very low to maximize recall)
- **Multiplier:** Requests `effectiveLimit * 10` results for client-side filtering
- **Returns:** All results include `similarity` score (0-1)
- **Deduplication:** By project_number, keeps most recent fiscal year

#### 5. searchPatents (line 1637) **ACTIVE**
**Status:** **Used by `executeTool` for `search_patents` tool**
```typescript
export async function searchPatents(
  params: SearchPatentsParams,
  userAccess: UserAccess
): Promise<PatentResult[]>
```
- **Purpose:** Hybrid patent search (semantic + keyword)
- **RPC:** `search_patents` for semantic component
- **Keyword:** Direct query on `patents.patent_title` with OR matching
- **Merge strategy:** Semantic results first (have similarity), then keyword-only results
- **Rationale:** Patent titles are short, semantic alone misses relevant results

#### 6. searchTrials (line 1843) **ACTIVE**
**Status:** **Used by `executeTool` for `search_trials` tool**
```typescript
export async function searchTrials(
  params: SearchTrialsParams,
  userAccess: UserAccess
): Promise<TrialSearchResult>
```
- **Purpose:** Semantic trial search with similarity scores
- **RPC:** `search_clinical_studies`
- **Threshold:** 0.15 (matches project search)
- **Multiplier:** Requests `effectiveLimit * 10` for client-side filtering
- **Returns:** All results include `similarity` score (0-1)
- **Filters:** status, is_therapeutic, is_diagnostic
- **Enrichment:** Fetches linked project info (title, org_name, total_cost)

### Helper Functions

#### getKeywordMatchingIds (line 1230)
- Supports pipe-separated synonyms: `"neural|brain|cerebral organoids"`
- Groups are AND'd together, synonyms within a group are OR'd

#### getSemanticResults (line 1281)
- Wrapper around `search_projects_filtered` RPC
- Default threshold: 0.25 (can be overridden)
- Falls back to `search_projects` RPC if filtered version unavailable

#### fetchProjectsByIds (line 1313)
- Fetches full project data for given application_ids
- Processes in batches of 500 to avoid query limits

### Tool Dispatcher (line 1972)

```typescript
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userAccess: UserAccess
): Promise<unknown>
```

| Tool Name | Function Called | Notes |
|-----------|-----------------|-------|
| `search_projects` | `searchProjectsSemantic` | Primary project search |
| `search_patents` | `searchPatents` | Hybrid search |
| `search_trials` | `searchTrials` | Semantic search |
| `get_company_profile` | `getCompanyProfile` | Org lookup |
| `get_pi_profile` | `getPIProfile` | PI lookup |
| `find_similar` | `findSimilar` | Embedding similarity |
| `get_patent_details` | `getPatentDetails` | Single patent details |
| `keyword_search` | `searchProjectsSemantic` | **Legacy redirect** |

### Database RPCs

| RPC Name | Used By | Index |
|----------|---------|-------|
| `search_projects_filtered` | searchProjectsSemantic, searchProjects | projects.abstract_embedding (HNSW) |
| `search_projects` | Fallback for above | projects.abstract_embedding (HNSW) |
| `search_patents` | searchPatents | patents.title_embedding (HNSW) |
| `search_clinical_studies` | searchTrials | clinical_studies.title_embedding (HNSW) |

---

## Reports Generation - Search Strategy

The reports module (`src/lib/reports/`) now uses the **same percentile-based approach** as the UI chat interface, ensuring consistency and high-quality results.

### Report Positioning

Reports represent a **curated, high-confidence subset** of NIH-funded research, not an exhaustive population analysis:
- **Executive summary & Market context** → Population-level perspective
- **Project/trial/patent data** → Deep insights from top 50-100 most relevant projects

### Comparison: Reports vs UI Search

| Aspect | UI Search (tools.ts) | Reports Agents |
|--------|---------------------|----------------|
| **Primary function** | `searchProjectsSemantic` | Direct RPC calls |
| **Threshold** | 0.15 (low, maximize recall) | 0.15 (same approach) |
| **Quality Control** | Client-side percentile filter | Server-side percentile filter |
| **Approach** | Semantic-only | Hybrid: keyword + semantic |
| **Target Output** | User-controlled (Broad/Balanced/Precise) | 50-100 high-confidence projects |
| **Data enrichment** | None | External API scraping |

### Report Agent Search Approaches

Each agent uses a **hybrid approach** combining multiple search strategies with percentile-based filtering:

#### Projects Agent (`agents/projects.ts`)
```typescript
// Three parallel searches:
1. Keyword search on title (ilike '%term%')
2. Keyword search on PHR (abstract equivalent)
3. Semantic search via search_projects_filtered RPC (threshold: 0.15)

// Merge and dedupe by project_number
// Sort by similarity score (captured from semantic search)
// Apply percentile filter: top 40% = ~75 high-confidence projects
// Target range: 50-100 projects
```

#### Trials Agent (`agents/trials.ts`)
```typescript
// Two parallel searches:
1. Keyword search on trial titles
2. Project-linked: semantic search (0.15) → project_numbers → linked trials

// Merge strategy: keyword first, linked second
// Data augmentation: ClinicalTrials.gov API for missing fields
```

#### Patents Agent (`agents/patents.ts`)
```typescript
// Two parallel searches:
1. Keyword search on patent titles (OR across all topic terms)
2. Project-linked: semantic search (0.15) → project_numbers → linked patents

// Merge strategy: linked first (more specific via project relevance)
// Data augmentation: Google Patents scraping for abstracts
```

#### Publications Agent (`agents/publications.ts`)
```typescript
// Two parallel searches:
1. Keyword search on publication titles
2. Project-linked: semantic search (0.15) → project_numbers → PMIDs → publications

// Merge strategy: keyword first (most specific)
// Data augmentation: PubMed E-utilities API for abstracts
```

### Why Low Threshold + Percentile Filtering

1. **Consistent approach**: Same pattern as UI search (learned from precision filter work)
2. **Better recall**: Low threshold captures more candidates
3. **Quality control**: Percentile filter ensures high-confidence results regardless of score clustering
4. **Hybrid approach**: Keyword search catches what semantic misses

### RPC Usage

| Agent | RPC Called | Parameters |
|-------|-----------|------------|
| Projects | `search_projects_filtered` | `match_threshold: 0.15`, `match_count: 500` |
| Trials/Patents/Pubs | `search_projects_filtered` | `match_threshold: 0.15`, `match_count: 100` |
| checkProjectCount | `search_projects` | `match_threshold: 0.25`, `match_count: 100` |

### Data Flow

```
Topic "CAR-T cell therapy"
         ↓
┌─────────────────────────────────────────────────────────────┐
│  PROJECTS AGENT                                              │
│  1. Keyword search: title ilike '%CAR-T%' OR '%CAR T%'      │
│  2. Keyword search: phr ilike '%CAR-T%' OR '%CAR T%'        │
│  3. Semantic: search_projects_filtered (0.15 threshold)     │
│  → Merge, capture similarity scores                         │
│  → Sort by similarity, apply top 40% percentile filter      │
│  → Output: 50-100 high-confidence projects                  │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  TRIALS/PATENTS/PUBLICATIONS AGENTS                         │
│  1. Keyword search on entity titles                          │
│  2. Semantic search (0.15) → project_numbers → linked data  │
│  → Merge, dedupe, enrich from external APIs                 │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  AGGREGATION                                                 │
│  Calculate funding stats, top orgs, top researchers         │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  SYNTHESIS (LLM)                                             │
│  Generate executive summary, format markdown report          │
│  Include "About This Report" methodology section             │
└─────────────────────────────────────────────────────────────┘
```

### Report Methodology Section

Every report includes an "About This Report" section explaining:
- Sample composition (projects, funding, orgs, PIs analyzed)
- Data sources and timeframe
- Limitations (depth over breadth, NIH-funded only)

---

## Related Documentation
- [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) - System overview
- [03_CLASSIFICATION_ALGORITHM.md](./03_CLASSIFICATION_ALGORITHM.md) - How projects are classified
