# Classifier Fine-Tuning Plan

**Created:** 2026-03-10
**Status:** Pending approval

---

## Current Baseline

| Category | Count | % at ≥80% conf |
|----------|-------|----------------|
| training | 23,203 | 100.0% |
| infrastructure | 19,967 | 98.4% |
| basic_research | 52,611 | 74.0% |
| biotools | 5,490 | 74.6% |
| therapeutics | 26,187 | 80.8% |
| diagnostics | 3,233 | 76.2% |
| medical_device | 2,508 | 90.8% |
| digital_health | 3,704 | 96.6% |
| other | 13,674 | 46.3% |
| **TOTAL** | 150,577 | **80.8%** |

---

## Proposed Changes

### 1. Therapeutics Keyword Gaps

**Problem:** Verb forms like "treating" don't trigger therapeutics scoring.

**Current keywords (title boost):**
```python
['treatment', 'therapy', 'therapeutic', 'drug', 'vaccine', 'inhibitor',
 'clinical trial', 'gene therapy', 'cell therapy', 'car-t', 'immunotherapy']
```

**Proposed additions:**
```python
# Title keywords to add:
'treating',        # Verb form (e.g., "for treating Alzheimer's")
'car-',            # Broader CAR pattern (CAR-T, CAR-M, CAR-NK, CAR-microglia)
'radiotherap',     # Radiotherapy/radiotherapeutic
'nanoparticle',    # When combined with treatment intent

# tx_strong patterns to add:
'car-nk', 'car-m', 'car-macrophage', 'car-microglia',
'to treat', 'for treating',
'radiotherapeutic', 'radiotherapy for',
'nanomedicine', 'nanoparticle therap',
'biologic', 'biologics',
```

**Rationale:** These are legitimate treatment development signals that the current classifier misses.

**Expected impact:**
- ~500-1000 projects may move from basic_research → therapeutics
- Fixes projects like "In Vivo Production of CAR-Microglia for Treating Alzheimer's Disease"

---

### 2. Contract/Intramural Activity Codes

**Problem:** ZIA, N01, N02, OT2, OT3 codes are at 0% confidence.

| Code | Description | Count (est.) |
|------|-------------|--------------|
| ZIA | Intramural research | ~500 |
| N01, N02 | Contracts | ~200 |
| OT2, OT3 | Other transaction agreements | ~100 |

**Proposed handling:**
```python
# Add to activity code handling at start of classify_project():
INTRAMURAL_CODES = {'ZIA', 'ZIB', 'ZIC', 'ZID', 'ZIE'}  # Intramural research
CONTRACT_CODES = {'N01', 'N02', 'N43', 'N44'}  # Contracts
OT_CODES = {'OT1', 'OT2', 'OT3'}  # Other transactions

# For intramural: classify by content, confidence 70% (lower because different format)
# For contracts: often service contracts → infrastructure at 60%
# For OT codes: classify by content, confidence 70%
```

**Rationale:** These don't follow standard grant patterns but still need classification.

**Expected impact:**
- ~800 projects get reasonable classification instead of 0%
- "other" category will shrink as these get proper categories

---

### 3. Tool Development Patterns

**Problem:** Some tool development projects stuck in basic_research at 70%.

**Examples found:**
- "Computational tools for illuminating the dark matter of the human virome"
- "Novel methods for dynamic MRI of gastrointestinal motor function"
- "Micro-capsules for versatile multiplexed cytometry"

**Proposed additions to biotools:**
```python
# bt_strong additions:
'tools for',           # More general than "develop a tool for"
'methods for',         # When in title
'computational method',
'imaging method for',
'novel method',

# Title keyword additions:
'tools for', 'methods for', 'novel method'
```

**Rationale:** These are clearly tool development projects, not basic research.

**Expected impact:**
- ~200-500 projects may move from basic_research → biotools

---

### 4. Disambiguation Rule Improvements

**Problem:** "targeting X to treat Y" patterns often stay in basic_research.

**Proposed new rule:**
```python
# Rule 15: "to treat" or "for treating" in title → therapeutics boost
if 'to treat' in t or 'for treating' in t:
    if scores['therapeutics'] >= 2:  # Has some therapeutic signals
        scores['therapeutics'] += 3
        scores['basic_research'] = max(0, scores['basic_research'] - 2)
```

**Rationale:** Explicit treatment intent in title is a strong therapeutic signal.

---

### 5. Low-Signal R01 Handling

**Problem:** Many R01s at 70% have no strong signals either way.

**Analysis:**
- 605 R01s at 70% basic_research confidence
- These often have generic titles with no category keywords

**Proposed approach:**
Keep as-is. R01s with no category signals default to basic_research at 70%, which is appropriate. This is honest uncertainty, not something to "fix" with artificial boosting.

**Not changing:** This is working as intended.

---

## Implementation Order

1. **Phase 1: Therapeutics keywords** (lowest risk, highest impact)
   - Add "treating", "car-", "radiotherap" to title keywords
   - Add strong patterns for CAR variants, biologics

2. **Phase 2: Contract/intramural codes** (medium risk)
   - Add special handling for ZIA, N01/N02, OT2/OT3
   - Test on sample before full run

3. **Phase 3: Biotools patterns** (medium risk)
   - Add "tools for", "methods for" patterns
   - Careful not to over-classify

4. **Phase 4: Disambiguation rules** (lowest priority)
   - Add "to treat" pattern
   - Re-evaluate after phases 1-3

---

## Testing Plan

Before applying each phase:

1. **Dry-run on sample**: Test 100 affected projects, review results
2. **Check for regressions**: Ensure changes don't break working classifications
3. **Measure impact**: Count how many projects would change category
4. **Review edge cases**: Manually check 10-20 changed projects for accuracy

---

## Success Criteria

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| Overall ≥80% | 80.8% | 82-85% | Modest improvement |
| basic_research ≥80% | 74.0% | 76-78% | Some should move out |
| other ≥80% | 46.3% | 50-55% | Contracts/intramural fixed |
| Misclassification rate | ~9%* | <7% | Based on sampling |

*Estimated from earlier analysis

---

## Approval Checklist

- [ ] Review proposed keyword additions
- [ ] Approve Phase 1 (therapeutics)
- [ ] Approve Phase 2 (contract codes)
- [ ] Approve Phase 3 (biotools)
- [ ] Approve Phase 4 (disambiguation)
- [ ] Approve full re-run after testing
