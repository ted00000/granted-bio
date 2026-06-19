## Classifier docs archive — 19JUN2026

These six documents predate the 2026-06-19 classifier consolidation.
Each describes a classification approach, QA plan, or workflow that
no longer matches the canonical implementation. They are preserved
here for historical context; do not act on them.

For the current state of classification, see:

- `etl/classifier.py` — the canonical classifier (Pass 1 deterministic
  + Pass 2 Claude Haiku 4.5)
- `etl/classify_projects_batched.py` — bulk reclassifier wrapper used
  by `load_fiscal_year.sh` step 6
- `etl/reclassify_existing.py` — targeted reclassification SOP
  (`--where-null`, `--current-category`, `--confidence-below`,
  `--activity-prefix`)
- `etl/sync_projects_via_api.py` — RePORTER API catch-up path
- `docs/CLASSIFIER_PROMPT_REVIEW.md` — the design rationale doc that
  led to the consolidation
- `etl/archive/2026-06-19_classifier_consolidation/README.md` — the
  matching code archive with the full file-by-file accounting

### What's in here

| File | What it described | Why archived |
|---|---|---|
| `03_CLASSIFICATION_ALGORITHM.md` | The legacy 5-tier weighted scoring biotools-only classifier. HIGH/MODERATE/LOW confidence buckets, 55-point SBIR/STTR boost, keyword-list scoring per tier. | Replaced by the canonical 9-category classifier. Five-tier scoring is gone. |
| `CLASSIFICATION_IMPROVEMENT_PLAN.md` | Proposal to move from keyword rules to few-shot learning. Identified the "develops vs. uses" problem and the missing therapeutics/diagnostics/medical_device/digital_health categories. | The few-shot idea informed the canonical prompt but the document itself is a proposal, not a description of shipped code. The canonical classifier *is* the realized version of this proposal. |
| `CLASSIFICATION_QA_PLAN.md` | March 2026 QA plan to build per-category validation sets and a self-improving confidence loop. Identified that 78% high-confidence was artificially boosted. | Validation now lives in `scripts/validate_classifier_prompt.py` against `etl/category_disagreements_clean.json`. The plan's framing (artificial boosts, per-category gold standards) is obsolete. |
| `CLASSIFICATION_QC_PLAN.md` | March 2026 three-phase plan to fix 27,386 potentially-misclassified projects + 34,827 low-confidence rows. Described category distribution problems and a self-improving system. | The "fix existing data" effort is now scoped through `reclassify_existing.py` (operator-driven, targeted filters). The blanket QC framing is obsolete. |
| `CLASSIFICATION_WORKFLOW.md` | March 2026 "complete workflow" doc covering org_type repair, primary_category assignment, batch processing patterns. Referenced multiple now-archived scripts. | The actual workflow is now the SOP described in `DATA_SOURCE_PLAYBOOKS.md` § Classification. This doc references files that no longer exist. |
| `CLASSIFIER_FINE_TUNING_PLAN.md` | March 2026 proposal with per-category baseline accuracy + proposed prompt changes. Pending approval status. | Superseded by the canonical prompt in `etl/classifier.py` and the design rationale in `docs/CLASSIFIER_PROMPT_REVIEW.md`. |

### If you need to consult one of these

Git history preserves everything. The original locations are:

```bash
git log --follow docs/archive/2026-06-19_classifier_consolidation/<filename>
```

Before reviving any of the approaches described here, read
`docs/CLASSIFIER_PROMPT_REVIEW.md` — it explains why the canonical
classifier landed on the design it did, and why the older approaches
were not carried forward.
