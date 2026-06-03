# Report Methodology — Audit Documentation

**Status: PLACEHOLDER.** This document is intended to be filled in once the
report architecture stabilizes. Its purpose is to give an educated auditor
enough detail to understand how data flows through the system, how relevance
is determined, and where the boundaries of our claims are — without exposing
proprietary prompt engineering or specific numerical tuning that constitutes
competitive differentiation.

The audience is a sophisticated reader (analyst, scientific advisor, due
diligence team) who needs to validate that the report's conclusions are
grounded in defensible methodology. This is NOT a marketing document and NOT
a code reference.

---

## Sections to write

### 1. Data Sources & Coverage
- The four primary databases (NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed)
- Update cadence and known lag for each
- What is in scope (e.g., NIH-funded vs. all federal funding) vs. out of scope
- Cross-source linkage mechanics at the project_number level
- Ingestion gaps and known coverage limitations

### 2. Semantic Search
- What semantic search means in our context (vector embeddings + cosine similarity)
- The embedding model used and what it captures conceptually
- The role of the user-selected interpretation (Narrow / Standard / Broad) in defining the query
- How the embedding-driven approach differs from keyword search
- How the picker affects scope (without exposing prompt internals)

### 3. Keyword Search & Where It Is Used
- Trials, patents, and publications discovered via topic-keyword search
- Why we use both semantic and keyword search (recall vs. precision tradeoffs)
- Which keyword sources come from the user's chosen interpretation
- Examples of what each path catches that the other misses

### 4. Thresholds for Inclusion
- Match Quality Tiers: Precise (similarity ≥ 0.50), Balanced (≥ 0.35)
- The 0.35 inclusion threshold for the report population
- The 0.35 funding-attribution threshold (and how to interpret it)
- Why we don't roll up umbrella-grant funding (e.g., P30 cancer centers)
- Why trials and patents may surface without contributing to funding totals

### 5. Per-Project Funding Calculation
- Sum across all NIH RePORTER budget-period rows
- Partial fiscal year (YTD) handling
- Difference vs. latest-budget-period-only reporting
- Why this matters for multi-year grants

### 6. Aggregation Logic
- Project counts: deduped by core project number
- Funding totals: across all budget periods for relevant projects
- Top Organizations: aggregated from projects + trials + patents
- Persona-aware sections (Investor vs. Researcher) and what differs

### 7. AI-Synthesized Narrative
- What is AI-generated (executive summary, signals, insights) vs. data-derived
- Constraint patterns: sample-aware language, partial-FY framing, statistical honesty at small N
- Limits of what AI synthesis can claim vs. data shown
- Where the model is explicitly told to hedge

### 8. Market Context Section
- Web-sourced supplementary content
- How market context is separated from NIH-derived analysis
- Source citation approach
- What we can and cannot verify

### 9. Known Limitations
- Cross-link with the "What This Report Does Not Cover" section in every report
- Coverage gaps (international, industry-internal, non-USPTO patents, etc.)
- Acknowledged AI limitations (model drift, generation variability)
- Why we anchor key analyses to deterministic data and use AI only for narrative

### 10. Reproducibility & Versioning
- What is deterministic vs. variable across report generations
- The role of the picker in establishing reproducible interpretation
- What changes when we update the embedding model or vector index
- Recommendation for re-running reports when data has been re-ingested

---

## What this document deliberately does NOT cover

- Specific prompt text or rewriting strategies
- Index parameters (HNSW ef_search, dimensions, etc.) beyond general approach
- Internal scoring weights or model selection rationale
- Vendor-specific implementation details (model identifiers, API specifics)

These are intentional omissions to keep the methodology auditable without
exposing the competitive components of the platform.
