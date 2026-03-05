# Intelligence Reports - Issues & Fixes

Tracking document for report generation improvements based on analysis of CAR-T cell therapy report.

---

## Scope

**Focus:** Data-driven sections pulling from platform data/APIs:
- NIH Funding Landscape (projects)
- Key Research Projects (projects)
- Clinical Pipeline (trials)
- Patent Activity (patents)
- Publication Trends (publications)
- Key Organizations (aggregated)
- Key Researchers (projects)

**Out of Scope (for now):**
- Executive Summary - will use Opus with specific formula
- Market Context - will use Opus with specific formula

---

## Critical Issues

### 1. Clinical Trials - Wrong Results
**Status:** ✅ Fixed
**Severity:** Critical
**File:** `src/lib/reports/agents/trials.ts`

**Problem:** Trials returned are NOT CAR-T specific. Getting general stem cell transplants and checkpoint inhibitors instead.

**Fix Applied:**
- [x] Unified threshold: 0.35
- [x] Hybrid approach: keyword search + project-linked search
- [x] Keyword search uses primary term (e.g., "CAR-T") for specificity
- [x] Prioritizes keyword matches over linked matches
- [x] Added deduplication by nct_id to prevent duplicate trials
- [x] On-demand enrichment from ClinicalTrials.gov API

---

### 2. Patents - Irrelevant Results
**Status:** ✅ Fixed
**Severity:** Critical
**File:** `src/lib/reports/agents/patents.ts`

**Problem:** Patents returned are generic immunotherapy, not CAR-T specific. Also had wrong column names (`patent_abstract` vs actual schema).

**Fix Applied:**
- [x] Unified threshold: 0.35
- [x] Hybrid approach: keyword search + project-linked search
- [x] Fixed column names to match actual schema (`patent_org`, `issue_date`, `filing_date`)
- [x] Prioritizes linked patents (from semantically relevant projects) over generic keyword matches

---

### 3. Publications - No Results
**Status:** ✅ Fixed
**Severity:** Critical
**File:** `src/lib/reports/agents/publications.ts`

**Problem:** "No publications found" for CAR-T - a heavily published field.

**Fix Applied:**
- [x] Unified threshold: 0.35
- [x] Hybrid approach: keyword search + project-linked search
- [x] Fixed column names to match schema (`pub_title`, `journal_title`, `author_list`)
- [x] Keyword search uses primary term for specificity
- [x] Prioritizes keyword matches over linked matches
- [x] Merges results from both approaches, deduplicates by PMID

---

## Moderate Issues

### 4. Duplicate Projects (Cross-Year)
**Status:** ✅ Fixed
**Severity:** Critical (inflates all counts)
**Files:**
- `src/lib/reports/agents/projects.ts`
- `src/app/api/researcher/[name]/route.ts`
- `src/app/api/org/[name]/route.ts`

**Problem:** Same projects appear multiple times across fiscal years.

**Fix Applied:**
- [x] Added deduplication by project_number to `src/lib/reports/agents/projects.ts`
- [x] Added deduplication by project_number to `src/app/api/researcher/[name]/route.ts`
- [x] Added deduplication by project_number to `src/app/api/org/[name]/route.ts`
- Keeps most recent fiscal year for each project_number

---

### 5. Duplicate Trials
**Status:** ✅ Fixed
**Severity:** Moderate
**File:** `src/lib/reports/agents/trials.ts`

**Problem:** NCT00653068 appears twice in results.

**Fix Applied:**
- [x] Added deduplication by nct_id in processResults

---

### 6. Character Encoding Issue
**Status:** ✅ Fixed
**Severity:** Low
**File:** `src/lib/reports/synthesize.ts`

**Problem:** Arrow character shows as "â" instead of "→" in markdown.

**Fix Applied:**
- [x] Changed Unicode "→" to ASCII "->" in project links

---

## Data Quality Issues

### 7. Projects with $0 Funding
**Status:** Open
**Severity:** Low

**Problem:** Some projects show $0 funding (e.g., Brenner's projects).

**Investigation Needed:**
- [ ] Check if these are subprojects/cores of larger grants
- [ ] May be infrastructure projects without direct funding

---

### 8. Search Consistency Across Platform
**Status:** ✅ Fixed
**Severity:** Moderate

**Unified Architecture Applied:**
- All agents (trials, patents, publications) now use UNIFIED_THRESHOLD = 0.35
- All agents use same hybrid approach: keyword search + project-linked search
- Project-linked search finds semantically relevant projects, then gets linked data
- Keyword search uses primary term from topic for specificity

**Test Results (CAR-T cell therapy):**
| Agent | Keyword | Linked | Total |
|-------|---------|--------|-------|
| Projects | n/a | 45 raw → 29 deduped | 29 |
| Trials | 23 | 30 | 57 |
| Patents | 30 | 5 | 30 |
| Publications | 30 | 30 | 30 |

---

## Major Enhancement: Project Intelligence Analysis

**Current State:** "Key Research Projects" is just a formatted list of projects with basic metadata.

**Desired State:** Claude analyzes the abstracts and provides real intelligence.

### Research Landscape Insights

1. **What science is happening** - Summarize the research approaches, methodologies, innovations
2. **Why it's interesting** - Highlight novel approaches, breakthroughs, unique angles
3. **Signals and patterns** - What trends does Claude see across the projects?
4. **Commonalities** - Shared targets, techniques, collaborations
5. **Over/under-invested areas** - Where is funding concentrated vs sparse?
6. **Research gaps** - What's NOT being funded that should be?
7. **Opportunities** - Where might there be whitespace for new research?

### Technical & Scientific Analysis

8. **Technology evolution** - How are approaches evolving? What's the trajectory?
9. **Target landscape** - What biological targets are being pursued? (receptors, pathways, cell types)
10. **Platform comparison** - Different technology platforms being used (viral vs non-viral, autologous vs allogeneic)
11. **Disease focus** - Which indications are getting attention? Any surprising applications?
12. **Combination strategies** - What's being combined with what?

### Competitive Intelligence

13. **Who's leading** - Which institutions/PIs are ahead and in what specific areas?
14. **Emerging players** - New entrants making interesting moves
15. **Collaboration networks** - Who's working together? Multi-institutional grants?
16. **Geographic concentration** - Where is the research happening?
17. **Funding trajectory** - Is funding increasing, plateauing, or declining?

### Translational Signals

18. **Clinical proximity** - Which research is closest to clinical application?
19. **Commercial potential** - What has clear path to products/therapies?
20. **Regulatory considerations** - Research addressing safety, manufacturing, scalability
21. **Academic vs industry** - Balance of fundamental vs applied research

### Strategic Takeaways

22. **Key themes** - 3-5 big themes emerging from the research
23. **Watch list** - Projects/teams to keep an eye on
24. **Investment thesis** - If you were to invest in this space, what would the thesis be?
25. **Risks and challenges** - What obstacles does the field face?

### Implementation

- [ ] Pass full abstracts to Claude (not just titles)
- [ ] Design prompt for research landscape analysis
- [ ] Structure output into actionable insights
- [ ] Use Opus for deeper analysis (this is where Opus shines)
- [ ] May need to chunk if too many abstracts (token limits)
- [ ] Consider multi-pass: first pass for extraction, second for synthesis

**Token Considerations:**
- 30 abstracts × ~300 words each = ~9,000 words = ~12,000 tokens input
- Opus can handle this, but adds cost (~$0.15-0.25 per analysis)
- Could summarize top 15-20 most relevant projects in detail

**Similar Analysis for Other Sections:**
This intelligence layer should extend to:
- **Clinical Trials** - Trial design trends, endpoint evolution, sponsor strategies
- **Patents** - IP landscape, claim strategies, freedom to operate signals
- **Publications** - Citation patterns, emerging authors, methodology trends

---

## Enhancement Ideas

- [ ] Add similarity scores to results for transparency
- [ ] User-configurable relevance threshold
- [ ] Show which results are "highly relevant" vs "related"
- [ ] Add keyword boost for exact term matches

---

## Testing Notes

**Test Query:** "CAR-T cell therapy" (with unified 0.35 threshold)

| Agent | Results | Notes |
|-------|---------|-------|
| Projects | 29 | Deduplicated from 45 raw rows |
| Trials | 57 | 23 keyword + 30 linked, enriched from ClinicalTrials.gov |
| Patents | 30 | Linked results prioritized (CAR-T relevant) |
| Publications | 30 | CAR-T specific publications |

**Sample CAR-T Projects:**
- CAR-T Therapy of Mesothelin Expressing Cancers
- Project 2: CAR-T cell therapy for T cell lymphoma
- Advancing Next Generation CAR-T cells for Renal Cell Carcinoma

**Sample CAR-T Patents (linked priority):**
- Generation of CTL Lines with Specificity Against Multiple Tumors
- METHODS OF CELL CULTURE FOR ADOPTIVE CELL THERAPY
- REVERSING THE EFFECTS OF THE TUMOR MICROENVIRONMENT USING CHIMERIC RECEPTORS

---

*Last Updated: 2026-03-04*
