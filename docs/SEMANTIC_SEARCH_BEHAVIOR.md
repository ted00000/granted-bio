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

## Related Documentation
- [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) - System overview
- [03_CLASSIFICATION_ALGORITHM.md](./03_CLASSIFICATION_ALGORITHM.md) - How projects are classified
