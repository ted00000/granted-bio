# Classification QA Plan

**Document:** Quality Assurance Strategy for NIH Grant Classification
**Created:** 2026-03-10
**Status:** Active

---

## Problem Statement

The classifier achieved ~78% of projects at ≥80% confidence through artificial title-based boosting. This masked underlying accuracy issues:
- ~9% of boosted basic_research projects may be misclassified
- Confidence scores don't reflect actual classification accuracy
- Classifier has gaps (e.g., "treating" vs "treatment", "radiotherapeutic")

**Goal:** Build confidence metrics that reflect ACTUAL accuracy, not artificial boosts.

---

## QA Framework

### 1. Create Gold Standard Validation Sets

**Per-category validation sets (50-100 projects each):**

| Category | Target Size | Selection Method |
|----------|-------------|------------------|
| basic_research | 100 | Random sample from R01/R21 grants |
| therapeutics | 100 | Random sample from SBIR + R01 with drug signals |
| biotools | 50 | Random sample from U24 + content-classified |
| diagnostics | 50 | Random sample from content-classified |
| medical_device | 30 | Random sample from SBIR device projects |
| digital_health | 30 | Random sample from content-classified |
| other | 50 | Random sample from behavioral/epi projects |
| training | 50 | Random sample from T32/F31/K-series |
| infrastructure | 50 | Random sample from P30/S10 |

**Labeling process:**
1. Export sample projects with title + abstract
2. Human labels each project (you or domain expert)
3. Store in `etl/validation/` as JSON files
4. Labels are ground truth for measuring accuracy

**File format:**
```json
{
  "application_id": "10123456",
  "title": "...",
  "abstract": "...",
  "gold_category": "therapeutics",
  "gold_confidence": "high|medium|low",
  "notes": "CAR-T for cancer treatment"
}
```

### 2. Accuracy Metrics

**Per-category metrics:**
- **Precision**: Of projects classified as X, what % are actually X?
- **Recall**: Of projects that ARE X, what % did we classify as X?
- **F1 Score**: Harmonic mean of precision and recall

**Overall metrics:**
- **Macro F1**: Average F1 across all categories (treats each category equally)
- **Weighted F1**: F1 weighted by category frequency

**Confidence calibration:**
- For projects at 90% confidence, actual accuracy should be ~90%
- For projects at 80% confidence, actual accuracy should be ~80%
- For projects at 70% confidence, actual accuracy should be ~70%

### 3. Error Analysis Process

**Weekly error review (during active development):**

1. **Sample errors**: Pull 10-20 misclassified projects from validation set
2. **Root cause analysis**: For each error, identify:
   - What signals did the classifier see?
   - What signals did it miss?
   - What rule would fix this?
3. **Categorize error types**:
   - Missing keyword (e.g., "treating" not in list)
   - Wrong disambiguation (e.g., tool usage vs development)
   - Conflicting signals (e.g., both therapeutics and basic_research signals)
   - Ambiguous project (genuinely hard to classify)
4. **Fix and retest**: Add keywords/rules, re-run on validation set

### 4. Classifier Improvement Protocol

**Before adding any rule:**
1. Document the error pattern (at least 3 examples)
2. Propose the fix
3. Test on validation set - must improve F1, not just accuracy on specific examples
4. Check for regression on other categories

**Rule change template:**
```
## Proposed Rule: [Name]

### Problem
[3+ examples of misclassified projects]

### Root Cause
[Why current classifier fails]

### Proposed Fix
[Code change]

### Validation Results
- Before: F1 = X.XX
- After: F1 = X.XX
- Regression check: [No regressions | Details]
```

### 5. Confidence Score Philosophy

**Confidence should reflect accuracy, not signal strength.**

Current approach (margin-based):
- margin >= 10 → 90%
- margin >= 6 → 85%
- etc.

**Better approach (calibrated confidence):**
- Validate that X% confidence projects are actually correct X% of the time
- If 80% confidence projects are only 70% accurate, adjust the thresholds

**Calibration check (run after classifier changes):**
```python
# For each confidence level, check actual accuracy
for conf in [90, 85, 80, 75, 70]:
    projects_at_conf = validation_set.filter(confidence=conf)
    actual_accuracy = projects_at_conf.correct / projects_at_conf.total
    print(f"{conf}% confidence: {actual_accuracy:.0%} actual accuracy")
```

---

## Implementation Steps

### Phase 1: Create Validation Sets (Required First)

```bash
# Export samples for labeling
python etl/export_validation_samples.py

# Output: etl/validation/samples_to_label.csv
# Columns: application_id, title, abstract, current_category, current_confidence
```

Manual labeling: ~500 projects total, ~2-3 hours of focused work.

### Phase 2: Baseline Measurement

```bash
# Run classifier on validation set, measure accuracy
python etl/validate_classifier.py

# Output:
# - Per-category precision/recall/F1
# - Confusion matrix
# - Confidence calibration
# - List of errors for analysis
```

### Phase 3: Fix Classifier Gaps

Known gaps to fix:
1. "treating" → should trigger therapeutics (currently only "treatment")
2. "radiotherapeutic" → should trigger therapeutics
3. "CAR-" prefix → should trigger therapeutics (CAR-T, CAR-M, CAR-NK)
4. "for [disease]" pattern in titles → check for therapeutic intent

### Phase 4: Iterate

1. Fix gap → re-run validation → check F1 improvement
2. Repeat until F1 plateaus
3. Document final accuracy metrics

---

## Success Criteria

| Metric | Target | Current (estimated) |
|--------|--------|---------------------|
| basic_research F1 | ≥0.90 | ~0.85 |
| therapeutics F1 | ≥0.90 | ~0.80 |
| biotools F1 | ≥0.85 | ~0.75 |
| diagnostics F1 | ≥0.85 | ~0.80 |
| other F1 | ≥0.80 | ~0.75 |
| Overall macro F1 | ≥0.85 | ~0.80 |
| Confidence calibration | ±5% | Unknown |

**Definition of "done":**
- Validation sets created and labeled
- Classifier achieves target F1 scores
- Confidence scores are calibrated (±5% of actual accuracy)
- No known systematic errors remaining

---

## File Structure

```
etl/
├── validation/
│   ├── README.md                    # How to use validation sets
│   ├── basic_research.json          # Gold standard labels
│   ├── therapeutics.json
│   ├── biotools.json
│   ├── diagnostics.json
│   ├── medical_device.json
│   ├── digital_health.json
│   ├── other.json
│   ├── training.json
│   └── infrastructure.json
├── export_validation_samples.py     # Export projects for labeling
├── validate_classifier.py           # Run validation, compute metrics
└── classify_from_database.py        # Main classifier
```

---

## Appendix: Known Classifier Gaps

### Missing Keywords (therapeutics)
- "treating" (verb form)
- "radiotherapeutic"
- "CAR-microglia", "CAR-NK", "CAR-M" (only "car-t" matched)
- "biologic" / "biologics"

### Missing Keywords (other)
- Potentially over-classifying to basic_research when clear behavioral signals exist

### Disambiguation Issues
- Projects with "for [disease]" in title often therapeutic but classified as basic_research
- "Development of X for Y" ambiguous between biotools and other categories

---

## Revision History

| Date | Change |
|------|--------|
| 2026-03-10 | Created QA plan after discovering artificial boosting issues |
