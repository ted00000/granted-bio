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

- [ ] Enrich clinical_studies table with full ClinicalTrials.gov data
  - Current: only title, status, therapeutic/diagnostic flags
  - Need: phase, conditions, interventions, enrollment, sponsors, dates, eligibility
  - ETL script to fetch from ClinicalTrials.gov API and populate DB
  - Enables internal trial detail page (keep users on site vs linking out)

---

## Future Ideas

(Add items here as they come up)
