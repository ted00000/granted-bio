# Classifier consolidation archive — 19JUN2026

Everything in this directory was archived as part of the classification
overhaul on 2026-06-19. The full story is in
`docs/CLASSIFIER_PROMPT_REVIEW.md` and the validation runs are recorded in
git history for the same date.

## What changed

Before 2026-06-19 the `etl/` directory had 50+ classification-related
files representing at least three parallel implementations:

1. A legacy 5-tier biotools-only classifier (`classify_projects.py`)
   that was wired inline into `load_to_supabase.py`.
2. A deterministic rule-based 9-category system
   (`semantic_classifier.py` + `classify_from_database.py`) that was
   NOT in the production pipeline despite being the "production
   workhorse" per the docs.
3. A Claude Haiku batched classifier (`classify_projects_batched.py`)
   that ran as step 6 of `load_fiscal_year.sh` and overwrote whatever
   the inline classifier wrote.

Plus dozens of one-off scripts for batch reclassification, validation,
QA, and disagreement analysis from various points in the project's
history.

After 2026-06-19 there is **one canonical classifier**:

- `etl/classifier.py` exposes `classify_projects(projects, abstracts_map)`
  which runs Pass 1 (activity-code routing) deterministically in Python
  and Pass 2 (content classification) via Claude Haiku.
- `etl/classify_projects_batched.py` survived as a thin wrapper that
  the load_fiscal_year.sh pipeline calls — it now imports and uses the
  canonical function.
- `etl/sync_projects_via_api.py` and `etl/reclassify_existing.py`
  also call into the canonical classifier.
- Inline classification in `load_to_supabase.py` was removed. Projects
  land with NULL primary_category and get classified by the post-load
  step.

## What's in here

### Code files

| File | Why archived |
|---|---|
| `classify_projects.py` | Legacy 5-tier biotools-only classifier. Replaced by canonical. |
| `classifier_v2.py` | Historical version. |
| `semantic_classifier.py` | Deterministic rule-based 9-category system. Not in production. |
| `classify_from_database.py` | Orchestrator that wrapped semantic_classifier. |
| `fix_bad_updates.py`, `reclassify_all.py`, `reclassify_categories.py`, `reclassify_other.py` | Wrappers around semantic_classifier. |
| `nih_grant_classifier.py` | Historical alternative. |
| `classify_projects_opus.py`, `reclassify_with_sonnet.py` | One-off batch runs with specific models. |
| `classify_semantic_batches.py`, `classify_all_projects.py`, `classify_semantic.py` | One-off batch tools. |
| `classify_semantic_131_140.py`, `classify_semantic_271_280.py`, `semantic_classifier_361_370.py`, `process_semantic_211_220.py`, `classify_batches_*.py` | Numbered one-off batches (the index numbers refer to specific batch ranges in historical runs). |
| `qa_sbir_classification.py`, `qc_categories.py`, `validate_classifier.py` | QA tooling for the archived classifiers. Replaced by `scripts/validate_classifier_prompt.py`. |
| `find_unclassified.py` | Replaced by `reclassify_existing.py --where-null`. |
| `export_*.py`, `import_*.py`, `merge_*.py`, `update_db_classifications.py`, `retry_failed_classifications.py` | One-off import/export/merge utilities from historical batch runs. |
| `sync_exporter_data.py` | Pre-SOP ExPORTER sync tool. Bypassed our delta-aware loaders. Replaced by per-entity diff + delta scripts. |

### Data and artifacts

| File | Why archived |
|---|---|
| `All_Disagreements_Mar_17.txt`, `Category Disagreements.rtf` | March 2026 disagreement analysis outputs. |
| `Mar 17 Classified Batches 1 to 90.rtf`, `Mar 17 Classifier Script.rtf` | March 2026 working notes. |
| `classification_backup_20260310_073553.csv` | Backup from March 10, 2026 reclassification run. |
| `classifications.json`, `test_batch_semantic.csv` | Test outputs from historical runs. |
| `PROJECT_PROMPT_SEMANTIC.md`, `Semantic_NIH_Project_Classifier_Final.md`, `classification_prompt.md`, `opus_classifier_prompt.md`, `semantic_review_prompt.md` | Historical prompt iterations. The canonical prompt lives in `etl/classifier.py`. |
| `training_reclassify_batches/` | Working directory from an earlier reclassification attempt. |

### What was NOT archived

- `etl/category_disagreements.json` and `etl/category_disagreements_clean.json` — these are the gold-standard correction data we used to validate the new classifier and may use again for future improvement.
- `etl/classifier.py` — the new canonical classifier.
- `etl/classify_projects_batched.py` — kept (renamed contents) as the thin wrapper invoked by load_fiscal_year.sh.
- `etl/process_*.py` — entity processors, unchanged.

## If you need any of this

Git history preserves everything. To inspect:

```bash
git log --follow etl/archive/2026-06-19_classifier_consolidation/<filename>
```

To restore a file:

```bash
git mv etl/archive/2026-06-19_classifier_consolidation/<filename> etl/<filename>
```

But before restoring anything: it was archived because it conflicted with
or was superseded by the canonical classifier. Re-introducing it requires
revisiting the consolidation decision.
