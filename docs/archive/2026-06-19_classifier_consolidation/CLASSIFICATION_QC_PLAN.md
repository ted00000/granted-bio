# Classification Quality Control Plan

## Executive Summary

We have 128,847 NIH projects with two classification dimensions:
- **org_type**: ✅ Fixed (5,949 corrections applied)
- **primary_category**: ⚠️ 27,386 potential issues, 34,827 low confidence

This plan outlines a 3-phase approach to fix current issues and build a self-improving system.

---

## Current State

### Category Distribution
| Category | Count | % | Issues |
|----------|-------|---|--------|
| other | 49,642 | 38.5% | Too many - likely contains therapeutics/diagnostics |
| therapeutics | 40,621 | 31.5% | Some may be basic research |
| biotools | 25,977 | 20.2% | May include tool *users* not developers |
| diagnostics | 9,080 | 7.0% | Seems reasonable |
| digital_health | 1,883 | 1.5% | Seems low |
| medical_device | 1,644 | 1.3% | Seems reasonable |

### Key Problems
1. **"other" is a catch-all**: 38.5% is too high - many should be categorized
2. **biotools overclassified**: Projects that *use* tools labeled as tool *development*
3. **Low confidence scores**: 34,827 projects (27%) have confidence < 60

---

## Phase 1: Conservative Automated Fixes (Today)

Apply rule-based fixes for **obvious** misclassifications only.

### 1.1 Fix "other" → specific category (High Confidence Only)

Only reclassify if:
- Current category is "other"
- Strong keyword matches (score >= 6, meaning 2+ strong keywords)
- No conflicting signals

```python
# Example: Reclassify to therapeutics if contains multiple strong signals
strong_therapeutics = ['clinical trial', 'phase i', 'phase ii', 'drug development',
                       'gene therapy', 'immunotherapy', 'car-t']
# Require 2+ matches to reclassify
```

**Estimated impact**: ~3,000-5,000 projects moved from "other" to specific categories

### 1.2 Do NOT auto-fix biotools → therapeutics

This is the most common flagged issue (7,189) but requires semantic understanding:
- "Developing a CRISPR platform for cancer research" = biotools
- "Using CRISPR to treat sickle cell disease" = therapeutics

**Decision**: Skip automated fixes, handle in Phase 2.

---

## Phase 2: Re-classification via Claude Max (This Week)

### 2.1 Export Flagged Projects

Export projects that need review:
1. All "other" category projects (49,642)
2. Low confidence projects (< 60) in other categories
3. Projects flagged by QC with score >= 6

**Total to re-classify**: ~50,000-60,000 projects

### 2.2 Improved Classification Prompt

Update `etl/classification_prompt.md` with:
- More examples of edge cases
- Clearer guidance on biotools vs therapeutics distinction
- Examples from the misclassifications we found

Key additions:
```
## CRITICAL: Tool Development vs Tool Application

The most common error is confusing these:

BIOTOOLS (developing the tool):
- "We will develop a CRISPR screening platform..."
- "This project creates a new sequencing method..."
- "We are building an AI model to predict drug targets..."

THERAPEUTICS (using tools for treatment):
- "We will use CRISPR to correct the genetic defect..."
- "This project applies our screening platform to identify cancer drugs..."
- "Using our AI model, we will develop treatments for..."

Ask: "What is the PRIMARY deliverable?"
- If it's a tool/platform/method for others to use → biotools
- If it's a treatment/therapy/drug → therapeutics
```

### 2.3 Batch Processing

Split into manageable batches:
- 10 files × 5,000-6,000 projects each
- Process through Claude Max (free with subscription)
- Import results

**Timeline**: 2-3 hours of processing time

---

## Phase 3: Continuous Improvement System (This Week)

Build a feedback loop where the system improves over time.

### 3.1 Database Schema

```sql
-- Store classification feedback from users/analysts
CREATE TABLE classification_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id TEXT NOT NULL REFERENCES projects(application_id),

  -- Current classification
  original_category TEXT,
  original_confidence FLOAT,

  -- Suggested correction
  suggested_category TEXT NOT NULL,
  feedback_source TEXT NOT NULL,  -- 'user', 'analyst', 'auto_qc'
  feedback_reason TEXT,

  -- Status
  status TEXT DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding pending feedback
CREATE INDEX idx_feedback_status ON classification_feedback(status);
CREATE INDEX idx_feedback_app_id ON classification_feedback(application_id);
```

### 3.2 Feedback UI Component

Add a subtle feedback mechanism to search results:

```tsx
// In search results, add a small feedback button
<button
  onClick={() => openFeedbackModal(project)}
  className="text-xs text-gray-400 hover:text-gray-600"
  title="Suggest category correction"
>
  <FlagIcon className="w-3 h-3" />
</button>

// Modal allows user to suggest correct category
<FeedbackModal>
  <p>Current: {project.primary_category}</p>
  <select>
    <option>therapeutics</option>
    <option>biotools</option>
    <option>diagnostics</option>
    ...
  </select>
  <textarea placeholder="Why? (optional)" />
</FeedbackModal>
```

### 3.3 Automatic QC on Search Results

When search returns results, run lightweight QC:

```typescript
// In search API, after getting results
async function checkResultClassifications(results: Project[]) {
  const suspicious = results.filter(p => {
    const keywords = extractKeywords(p.title + ' ' + p.abstract);
    const expectedCat = inferCategory(keywords);
    return expectedCat !== p.primary_category && confidenceScore(keywords) > 0.8;
  });

  if (suspicious.length > 0) {
    // Log for review, don't auto-correct
    await logSuspiciousClassifications(suspicious);
  }
}
```

### 3.4 Weekly Review Process

1. **Export pending feedback**: `SELECT * FROM classification_feedback WHERE status = 'pending'`
2. **Review and approve/reject**: Admin reviews suggestions
3. **Apply approved changes**: Update projects table
4. **Track accuracy metrics**: Monitor classification quality over time

### 3.5 Periodic Re-classification

Monthly job to:
1. Re-classify projects with low confidence + feedback suggesting errors
2. Re-classify newly uploaded projects
3. Update confidence scores based on accumulated feedback

---

## Implementation Order

### Today (Phase 1)
- [ ] Run conservative auto-fixes on "other" category
- [ ] Commit QC scripts

### This Week (Phase 2)
- [ ] Update classification prompt with edge case examples
- [ ] Export ~50K projects needing review
- [ ] Re-run classification through Claude Max
- [ ] Import results

### This Week (Phase 3)
- [ ] Create classification_feedback table
- [ ] Add feedback button to search results UI
- [ ] Build admin review interface
- [ ] Implement automatic QC logging

### Ongoing
- [ ] Weekly review of feedback
- [ ] Monthly re-classification of flagged projects
- [ ] Track and report classification accuracy

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| "other" category % | 38.5% | < 25% |
| Low confidence (< 60) | 27% | < 15% |
| Avg confidence score | ~70 | > 80 |
| User feedback corrections/month | N/A | < 50 |

---

## Scripts Created

| Script | Purpose |
|--------|---------|
| `etl/qc_org_types.py` | QC org_type classifications |
| `etl/fix_org_types.py` | Apply org_type fixes |
| `etl/qc_categories.py` | QC primary_category classifications |
| `etl/fix_categories.py` | Apply category fixes (to be created) |
| `etl/export_for_reclassification.py` | Export flagged projects (to be created) |

---

## Appendix: Edge Cases Reference

### Biotools vs Therapeutics
| Project | Correct Category | Why |
|---------|-----------------|-----|
| "Developing CRISPR screening platform" | biotools | Creating a tool |
| "CRISPR therapy for sickle cell" | therapeutics | Treating disease |
| "AI model for drug discovery" | biotools | Tool for research |
| "AI-guided drug development for cancer" | therapeutics | Goal is treatment |

### Diagnostics vs Biotools
| Project | Correct Category | Why |
|---------|-----------------|-----|
| "Biomarker discovery methods" | biotools | Developing methods |
| "Validating biomarkers for early cancer detection" | diagnostics | Clinical application |

### Other (Appropriate Uses)
| Project | Why "other" is correct |
|---------|----------------------|
| "Understanding cancer cell metabolism" | Basic science |
| "Epidemiology of diabetes in rural populations" | Public health |
| "T32 Training Grant in Neuroscience" | Training grant |
