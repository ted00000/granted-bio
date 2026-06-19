# Classification Improvement Plan: Few-Shot Learning Approach

## Problem Statement

The current classification system marks too many projects as "biotools" when they should be categorized more specifically (therapeutics, diagnostics, medical_device, digital_health). The rule-based keyword matching in `etl/classify_projects.py` lacks the nuance to distinguish between:

- Projects that **develop** a tool (biotools)
- Projects that **use** a tool for therapeutic/diagnostic purposes (therapeutics/diagnostics)
- Projects with multiple potential categories

## Current State

- **29,310 projects** classified as "biotools"
- **31,037 projects** classified as "other"
- **0 projects** in therapeutics, diagnostics, medical_device, digital_health
- Rule-based system uses weighted keyword scoring which misses context

## Proposed Solution: Few-Shot Learning

Instead of complex keyword rules, teach Claude how to classify by showing examples of correctly classified projects.

### How Few-Shot Learning Works

1. **Create Gold Standard Examples**: Manually classify 50-100 diverse projects across all categories
2. **Include Examples in Prompt**: When classifying new projects, show these examples in the prompt
3. **Claude Learns Pattern**: Claude uses the examples to understand classification criteria
4. **Apply at Scale**: Run classification on all 60K projects using the example-based prompt

### Why This Approach

- **More accurate**: Claude understands context ("we will develop X" vs "we will use X")
- **Easier to maintain**: Add/adjust examples instead of complex rules
- **Self-documenting**: Examples serve as classification criteria documentation
- **Flexible**: Easy to add new categories or refine existing ones

## Implementation Steps

### Step 1: Export Sample Projects for Manual Classification

```python
# etl/export_samples_for_classification.py

# Export ~200 diverse projects:
# - 50 currently classified as biotools (validate or reclassify)
# - 50 currently classified as other (likely misclassified)
# - 100 random sample across all projects

# Include: application_id, title, org_name, abstract, phr, terms
# Output: samples_for_classification.csv
```

### Step 2: Manual Classification (Human Task)

Review each sample project and assign:
- **primary_category**: biotools | therapeutics | diagnostics | medical_device | digital_health | other
- **classification_rationale**: Brief reason for classification (helps build prompt examples)

Classification criteria:
- **biotools**: Research tools, instruments, platforms, assays, enabling technologies for other research
- **therapeutics**: Drug development, treatments, immunotherapy, gene therapy, drug delivery
- **diagnostics**: Disease detection, screening tests, biomarker discovery, companion diagnostics
- **medical_device**: Implantable devices, surgical tools, therapeutic devices, prosthetics
- **digital_health**: Health apps, telemedicine, AI diagnostics, wearables, health monitoring
- **other**: Basic research, epidemiology, health services, policy, training grants

### Step 3: Create Few-Shot Classification Prompt

```python
# Structure for classification prompt

CLASSIFICATION_EXAMPLES = """
Here are examples of correctly classified projects:

EXAMPLE 1 - BIOTOOLS:
Title: "Development of a Novel CRISPR Screening Platform"
Abstract: "We will develop a high-throughput CRISPR screening platform that enables researchers to identify gene targets..."
Classification: biotools
Rationale: This project develops a research tool (screening platform) for use by other researchers.

EXAMPLE 2 - THERAPEUTICS:
Title: "CAR-T Cell Therapy for Pancreatic Cancer"
Abstract: "This project aims to develop a novel CAR-T cell therapy targeting mesothelin for treatment of pancreatic cancer..."
Classification: therapeutics
Rationale: This project develops a treatment (CAR-T therapy) for a disease.

EXAMPLE 3 - DIAGNOSTICS:
Title: "Early Detection of Alzheimer's Using Blood Biomarkers"
Abstract: "We propose to validate a panel of blood-based biomarkers for early detection of Alzheimer's disease..."
Classification: diagnostics
Rationale: This project develops a diagnostic test for disease detection.

EXAMPLE 4 - BIOTOOLS (edge case):
Title: "CRISPR-Based Tool for Cancer Research"
Abstract: "We will develop CRISPR tools that will be used by the research community to study cancer biology..."
Classification: biotools
Rationale: Even though it mentions cancer, the primary output is a research tool for others to use.

EXAMPLE 5 - THERAPEUTICS (edge case):
Title: "Using CRISPR to Treat Sickle Cell Disease"
Abstract: "We will use CRISPR gene editing to correct the sickle cell mutation in patient cells for therapeutic benefit..."
Classification: therapeutics
Rationale: CRISPR is being used as the means to develop a treatment, not as the end product.

[... 10-20 more carefully curated examples covering edge cases ...]
"""

CLASSIFICATION_PROMPT = f"""
{CLASSIFICATION_EXAMPLES}

Now classify this project:

Title: {{title}}
Organization: {{org_name}}
Abstract: {{abstract}}
Public Health Relevance: {{phr}}
Terms: {{terms}}

Respond with JSON:
{{
  "primary_category": "biotools|therapeutics|diagnostics|medical_device|digital_health|other",
  "confidence": 0-100,
  "rationale": "brief explanation"
}}
"""
```

### Step 4: Batch Classification Script

```python
# etl/classify_with_examples.py

import anthropic
from tqdm import tqdm

client = anthropic.Anthropic()

def classify_project(project: dict) -> dict:
    """Classify a single project using few-shot learning."""
    prompt = CLASSIFICATION_PROMPT.format(
        title=project['title'],
        org_name=project['org_name'],
        abstract=project['abstract'] or '',
        phr=project['phr'] or '',
        terms=project['terms'] or ''
    )

    response = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )

    # Parse JSON response
    return json.loads(response.content[0].text)

def batch_classify(batch_size=100):
    """Classify all projects in batches."""
    # Fetch unclassified or poorly classified projects
    # Process in batches with progress bar
    # Update database with results
    # Log statistics
    pass
```

### Step 5: Validation

After running classification:

```sql
-- Check distribution
SELECT primary_category, COUNT(*) as count
FROM projects
GROUP BY primary_category
ORDER BY count DESC;

-- Expected: More balanced distribution across categories

-- Check confidence scores
SELECT
  primary_category,
  AVG(primary_category_confidence) as avg_confidence
FROM projects
GROUP BY primary_category;

-- Spot check low-confidence classifications for review
SELECT application_id, title, primary_category, primary_category_confidence
FROM projects
WHERE primary_category_confidence < 60
ORDER BY primary_category_confidence
LIMIT 50;
```

## Key Examples to Include (Suggested)

When creating gold standard examples, ensure coverage of:

1. **Clear biotools**: Sequencing platforms, assay development, screening tools
2. **Clear therapeutics**: Drug candidates, gene therapy, immunotherapy
3. **Clear diagnostics**: Screening tests, biomarker panels, imaging methods
4. **Tool vs. Application edge cases**: CRISPR tool development vs. CRISPR therapy
5. **Multi-purpose projects**: Projects that could fit multiple categories
6. **Organization context**: How org type (company vs. university) affects classification

## Cost Estimate

Using Claude Haiku API:
- Input: ~800 tokens per project (examples + project data)
- Output: ~50 tokens per project (JSON response)
- Cost: ~$0.0002 per project
- **Total for 60K projects: ~$12**

## Timeline

1. **Export samples**: 1 hour (script development)
2. **Manual classification**: 2-3 hours (human review of 100 samples)
3. **Build few-shot prompt**: 1-2 hours (iterate on examples)
4. **Test on subset**: 1 hour (validate accuracy on 500 projects)
5. **Run full classification**: 2-3 hours (API calls + monitoring)
6. **Validation**: 1 hour (spot checks, fix issues)

**Total: ~8-12 hours of work**

## Future Enhancements

- Add secondary_categories for multi-category projects
- Implement org_type classification in same pass
- Create feedback loop where search analysts can flag misclassifications
- Periodically retrain with new examples
