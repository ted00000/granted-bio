# Parking Lot

Ideas and features to explore later.

---

## Results & Tiers

- [ ] Show "viewing X of Y results" based on subscription tier
  - Free tier sees 25 results, paid sees 100+
  - Consider showing upgrade prompt when results are capped
  - Apply to both project search and trials search

---

## UI/UX

- [ ] Update Results panel subtitle based on agent mode
  - Currently shows "NIH RePORTER & USPTO" for all modes
  - Trials mode should show different subtitle (e.g., "ClinicalTrials.gov")
  - Consider dynamic subtitle per persona

---

## Data Enrichment

- [x] Enrich clinical_studies table with full ClinicalTrials.gov data
  - Migration: `supabase/migrations/20260301_enrich_clinical_studies.sql`
  - ETL script: `etl/enrich_clinical_trials.py`
  - Trial detail page: `/trial/[nctId]`

- [x] Regenerate trial embeddings with richer text
  - Script: `etl/regenerate_trial_embeddings.py`
  - Uses: study_title + conditions + brief_summary (vs just title before)
  - Fixes semantic search missing synonyms (e.g., "scleroderma" ↔ "systemic sclerosis")
  - **Done**: 38,138 embeddings, $0.11 total cost

---

## Custom Reports (Future)

Goal: Agent-generated reports on research topics, companies, or therapeutic areas.

**Data architecture decisions:**

- **Patents (46K)**: Internalize key fields (title, abstract, claims summary, inventors, assignees, dates)
  - Static data, manageable size, better UX for browsing
  - Agent has instant access for reports
  - **BLOCKED**: PatentsView API registration suspended (March 2026)
  - Alternatives: USPTO bulk data, scraping, or wait for API access
  - Internal patent detail pages ready at `/patent/[id]` (local data only for now)

- **Publications (203K linked)**: On-demand fetch from PubMed
  - Keep our `publications` table (PMIDs, basic metadata)
  - Agent can only fetch details for PMIDs in our DB (constrained to NIH-linked corpus)
  - No free roaming — prevents rabbit holes, keeps reports focused
  - Lean storage, on-demand enrichment when needed for reports

**Report flow:**
1. Agent queries our DB → projects, patents, trials
2. Agent fetches publication details from PubMed for specific PMIDs as needed
3. Agent synthesizes into custom report

---

## Future Ideas

(Add items here as they come up)
