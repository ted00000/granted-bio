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
  - Currently shows "NIH RePORTER & USPTO PatentsView" for all modes
  - Trials mode should show different subtitle (e.g., "ClinicalTrials.gov")
  - Consider dynamic subtitle per persona

---

## Data Enrichment

- [x] Enrich clinical_studies table with full ClinicalTrials.gov data
  - Migration: `supabase/migrations/20260301_enrich_clinical_studies.sql`
  - ETL script: `etl/enrich_clinical_trials.py`
  - Trial detail page: `/trial/[nctId]`

- [ ] Regenerate trial embeddings with richer text
  - Script: `etl/regenerate_trial_embeddings.py`
  - Uses: study_title + conditions + brief_summary (vs just title before)
  - Fixes semantic search missing synonyms (e.g., "scleroderma" ↔ "systemic sclerosis")
  - **Running**: ~3 hours for 38K trials

---

## Future Ideas

(Add items here as they come up)
