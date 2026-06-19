# Classifier Prompt Review — 19JUN2026

Pre-work for consolidating to a single canonical classifier. The current
prompt lives in `etl/classifier.py` (carried over from the historical
`classify_projects_batched.py`). This doc walks every known issue with
that prompt and proposes specific replacement language.

**How to use this doc:**

For each issue, read the current state → evidence → proposed change →
rationale. Mark up directly:

- ✅ Ship the proposed change
- ❌ Reject (note why, so we don't lose context)
- ✏️ Edit (your own wording)
- 🤔 Need to discuss before deciding

When you've marked everything up, I'll incorporate decisions into
`etl/classifier.py`, run validation against the historical disagreement
data, and report results.

---

## What the current prompt does (in one paragraph)

The prompt has four layers: (1) an activity-code pre-filter that
deterministically routes T/F/K/R25/R90/D43/D71 to `training` and
P30/P50/P51/S10/G20/U13/R13/U24/U2C to `infrastructure`; (2) a "primary
deliverable" framing that asks what the project produces (knowledge →
basic_research, tool → biotools, drug → therapeutics, etc.); (3) eight
disambiguation rules (USES vs DEVELOPS, biomarker intent, drug
studies, AI/ML routing, etc.); (4) one-line org-type guidance. There
are no examples. The model is forced to pick exactly one of nine
categories with no review/flag option.

---

## Issue 1 — Missing therapeutic vocabulary

### Current state

The prompt says "Drug/treatment → therapeutics" with no enumeration of
the actual vocabulary therapeutic projects use.

### Evidence

`docs/CLASSIFIER_FINE_TUNING_PLAN.md` (March 10, 2026) explicitly listed
these as missed patterns:

- Verb forms: "treating," "treatment of"
- Modalities: "biologic," "biologics," "radiotherapeutic," "radiotherapy"
- Cell therapies: "CAR-T," "CAR-NK," "CAR-M," "CAR-microglia," and other CAR-X
- Conjugates: "ADC," "antibody-drug conjugate," "immunoconjugate"
- Nucleic acid: "mRNA vaccine," "mRNA therapeutic"
- Delivery: "nanoparticle" + therapeutic context

### Proposed addition

Insert a "Therapeutics keyword expansion" block after Rule 4:

```
## Therapeutics keyword expansion

Strong therapeutic signals include the following terms in the title or
abstract, especially when paired with disease context or efficacy/safety
language:

- "treating [disease/condition]" / "treatment of [disease/condition]"
- "therapeutic" / "therapy" / "therapies"
- "biologic" / "biologics" / "biological agent"
- "radiotherapeutic" / "radiotherapy" / "radio-conjugate"
- "CAR-T" / "CAR-NK" / "CAR-M" / "CAR-microglia" or any "CAR-X" cell therapy
- "ADC" / "antibody-drug conjugate" / "immunoconjugate"
- "mRNA vaccine" / "mRNA therapeutic"
- "nanoparticle" + therapeutic context (delivery, drug, formulation)
- "gene therapy" / "gene editing" with explicit therapeutic intent
- "small molecule" + ("inhibitor" OR "agonist" OR "antagonist") + disease
- "monoclonal antibody" / "mAb" + disease context
- "vaccine" + disease prevention or treatment context

BUT: these terms alone do NOT make a project therapeutic. Apply Rule 4
(USES vs DEVELOPS). Many basic research projects mention these terms
while studying biology, not developing a treatment.
```

### Rationale

Closes a known vocabulary gap. The qualifier at the bottom prevents
over-classification.

---

## Issue 2 — therapeutics over-assignment (3,011 disagreements)

### Current state

Rule 4 says: "Understand how drug X works → basic_research. Optimize
drug X for efficacy → therapeutics." That's correct in principle but
the model defaults to therapeutics when "drug" appears in the title.

### Evidence

`etl/category_disagreements.json` shows **3,011 projects corrected from
therapeutics to basic_research** — the single largest disagreement
bucket. Pattern: mechanism-of-action studies using a drug as a tool get
mislabeled because "drug" triggers therapeutics.

### Proposed addition

Replace Rule 4 with this expanded version:

```
4. CRITICAL DISTINCTION: studying-a-drug vs developing-a-drug

   A project that USES a drug to study biology → basic_research.
   A project that DEVELOPS or OPTIMIZES a drug → therapeutics.

   Three tests, applied in order:

   TEST A — strip the drug name. Does the project still make sense as
   a basic biology study?
     YES → basic_research
         e.g., "We use rapamycin to investigate mTOR signaling in cancer"
     NO  → therapeutics
         e.g., "Develop a rapamycin analog with improved selectivity"

   TEST B — what is the project DELIVERING at the end?
     Mechanism knowledge → basic_research
     Validated target for future drug development → basic_research
     Improved drug candidate / new dosing / new formulation → therapeutics
     Efficacy data toward an IND or clinical trial → therapeutics

   TEST C — what is the verb in the title or Aim 1?
     "Studying," "investigating," "characterizing," "elucidating,"
     "examining," "exploring" → basic_research
     "Developing," "optimizing," "validating efficacy of,"
     "advancing to clinic," "translating to" → therapeutics
```

### Rationale

The single largest accuracy lever. Forces structured reasoning about
deliverable rather than keyword pattern-matching.

---

## Issue 3 — basic_research under-assignment (3,218 disagreements)

### Current state

basic_research is framed as the residual ("Knowledge/understanding →
basic_research") which makes it feel like the loser of disambiguation
tie-breaks.

### Evidence

`etl/category_disagreements.json` shows **3,218 projects corrected TO
basic_research** — the largest target of reclassification, mostly from
therapeutics, biotools, and diagnostics.

### Proposed addition

Insert a positive characterization of basic_research before the
disambiguation rules:

```
## basic_research is a primary category, not a fallback

basic_research is the largest and most heterogeneous category. It covers
any project whose primary deliverable is biological knowledge —
understanding mechanism, characterizing a phenomenon, or discovering
new biology.

Characteristic patterns:
- Mechanism studies (signaling, gene regulation, structure-function)
- Discovery / characterization (new genes, pathways, cell types, phenomena)
- Model system use FOR studying biology
  (developing a model system FOR others to use is biotools — note the
  distinction)
- Cohort or epidemiological studies of disease biology
- Comparative biology / evolution
- Single-cell / multi-omic profiling for biological understanding
- Imaging studies focused on biological process visualization

If a project mentions a disease, drug, or clinical application but the
PRIMARY OUTPUT is biological understanding rather than a tangible
deliverable (drug, test, device, software, tool), it is basic_research.

Disease relevance ≠ therapeutic development.
Tool use ≠ tool development.
Diagnostic context ≠ diagnostic development.
```

### Rationale

Reframing basic_research as a positively-defined category — rather than
a residual — gives the model permission to assign it confidently.

---

## Issue 4 — The "for [disease]" pattern

### Current state

Not explicitly addressed.

### Evidence

Multiple plan docs cite this as a common confusion source. Many basic
research projects say "for cancer," "for Alzheimer's," "for autism"
without being therapeutic or diagnostic work.

### Proposed addition

New disambiguation rule (renumber as Rule 9):

```
9. The "for [disease]" pattern is NOT determinative

Many basic research projects describe their work as "for cancer," "for
Alzheimer's," "for autism" etc. without being therapeutic, diagnostic,
or biotools work.

Examples of "for [disease]" that ARE basic_research:
- "Novel signaling pathway for cancer therapy"
  (mechanism work with therapeutic implications; not a therapy itself)
- "New mouse model for Alzheimer's"
  (model use; unless explicit "for use by other researchers")
- "Single-cell atlas for liver disease"
  (descriptive biology with disease context)

Examples of "for [disease]" that are NOT basic_research:
- "Developing a diagnostic test for early Alzheimer's" → diagnostics
- "Optimizing antibody for breast cancer immunotherapy" → therapeutics
- "Building an open-access cancer organoid biobank" → biotools

Test: strip the disease context. Is there still a deliverable beyond
knowledge?
```

### Rationale

Disease vocabulary triggers therapeutic / diagnostic classification too
easily. Surfacing this as a not-determinative pattern with worked
examples reduces false positives.

---

## Issue 5 — Contract / intramural / special activity codes

### Current state

Pass 1 covers R-series, F-series, K-series, T-series, P-series, S10,
G20, U13, U24, U2C, D43, D71. Misses several known patterns.

### Evidence

`docs/CLASSIFIER_FINE_TUNING_PLAN.md` flagged: ZIA (NIH intramural),
N01/N02 (research contracts), OT2/OT3 (other transactions), S07-S11
(institutional support).

### Proposed addition

Extend Pass 1:

```
**Always → infrastructure (contract / intramural):**
ZIA (NIH intramural research projects)
N01, N02 (NIH research contracts)
OT2, OT3 (other transactions / collaborative agreements)
S07, S08, S09, S11 (institutional support and infrastructure)

These activity codes denote contractual or intramural funding mechanisms
whose primary deliverable is institutional capacity or services, not
new science. Classify as infrastructure regardless of content.
```

### Rationale

Deterministic gain. Removes content-analysis ambiguity for a clear
non-trivial fraction of awards.

---

## Issue 6 — SBIR / STTR explicit handling

### Current state

SBIR/STTR mentioned only as a company-org signal. No category-specific
guidance.

### Evidence

SBIR/STTR (R41/R42/R43/R44) is statutorily small-business product
development. These awards rarely fall into basic_research, training, or
infrastructure. `docs/CLASSIFICATION_WORKFLOW.md` has a multi-paragraph
SBIR/STTR section that never made it into the prompt.

### Proposed addition

Insert as a top-level section between Pass 1 and Pass 2:

```
## SBIR / STTR special handling

Activity codes R41, R42, R43, R44 are SBIR/STTR — Small Business
Innovation Research and Small Business Technology Transfer. By statute,
these fund small business product development. They are almost never
basic_research, training, or infrastructure.

For SBIR/STTR awards, classify into one of:
- biotools, therapeutics, diagnostics, medical_device, or digital_health

…depending on the PRODUCT being developed.

Notes:
- Phase I (R43, R41) is feasibility / proof-of-concept for the product.
- Phase II (R44, R42) is development toward commercialization.
- "Development of," "system," "platform," and "novel" language is normal
  for SBIR and does NOT by itself signal biotools — apply the standard
  primary-deliverable test.
- If a SBIR/STTR genuinely doesn't fit any product category, use "other"
  and confidence ≤ 30 to flag for review.
```

### Rationale

SBIR/STTR has a structurally different funding intent than typical
research grants. Without explicit handling, the model can over-assign
SBIR to basic_research when titles sound science-y.

---

## Issue 7 — org_type rules are too thin

### Current state

Five one-line definitions. Misses university hospitals, VA centers,
federal labs, foundations.

### Evidence

Operator flagged org_type alongside category as troublesome. No
specific disagreement counts surfaced but the thin rules clearly leave
many edge cases.

### Proposed replacement

Replace the org_type section with:

```
## Organization types

### company (private commercial entities)
Signals:
- Names ending in Inc., LLC, Corp., Corporation, Ltd., Co.
- "Therapeutics," "Biosciences," "Pharma," "Diagnostics" in the org name
- All SBIR/STTR awards (activity codes R41/R42/R43/R44) are companies
- "Holdings," "Capital," "Ventures" suffixes (parent companies)

### university (academic degree-granting institutions)
Signals:
- "University of," "University," "College" in name
- "Institute of Technology" (MIT, Caltech, Georgia Tech) — academic
- Includes university medical schools and affiliated medical centers
  (UCSF, UCLA Health, Johns Hopkins Medicine, etc.)
- State universities and land-grant institutions

### hospital (independent medical centers and health systems)
Signals:
- "Hospital," "Medical Center," "Health System," "Clinic" in name
  AND NOT university-affiliated
- Independent hospitals: Mayo Clinic, Cleveland Clinic,
  Mass General Brigham, Memorial Sloan-Kettering, MD Anderson
- VA Medical Centers (Department of Veterans Affairs)
- Children's hospitals: Boston Children's, CHOP, Cincinnati Children's

### research_institute (independent non-profit research orgs)
Signals:
- "Institute" without a university degree-granting parent: Broad, Salk,
  Scripps, Whitehead, Fred Hutchinson, Cold Spring Harbor, Allen Institute
- Foundation labs: Howard Hughes Medical Institute (HHMI),
  Chan Zuckerberg (CZI), Wellcome
- Federally Funded Research and Development Centers (FFRDCs)

### other
Signals:
- Government agencies (NIH intramural divisions, FDA, CDC, VA Office)
- Foundations and 501(c)(3) non-profits without dedicated research labs
- Professional societies
- International organizations
- Anything ambiguous after the above

Edge cases:
- Hospital + university affiliation: classify by the org_name on the
  award itself, not by the affiliation
- Industry-academic partnerships: classify by the org_name receiving
  the award
- If genuinely ambiguous after applying all rules, default to "other".
  The admin review queue will catch it.
```

### Rationale

Adds the specific institution names and disambiguation patterns the
model needs for edge cases. The closing "if ambiguous, default to other"
gives an honest escape valve.

---

## Issue 8 — Add a "flag for review" output mechanism

### Current state

Model must pick one of 9 categories. No way to indicate "this is
genuinely uncertain — a human should look."

### Evidence

The `category_corrections` admin queue (built May 2026) exists
specifically to absorb edge cases. Today it surfaces low-confidence
predictions. A formalized review escape valve in the prompt would
produce cleaner signals.

### Proposed addition

Insert near the end of the prompt, just before the "Return ONLY the
JSON array" line:

```
## When you are GENUINELY uncertain

If after applying all rules and tests you cannot confidently classify
a project into one of the nine categories, set:

  primary_category: "other"
  category_confidence: ≤ 30

Low-confidence "other" classifications will surface in the admin review
queue for human inspection. It is BETTER to flag for review than to
force a confident wrong answer.

DO NOT over-use this escape. Most projects fit cleanly into one of the
nine categories. Use the review path only when the abstract is genuinely
unparseable, internally contradictory, or describes work that spans
multiple categories with no clear primary.
```

### Rationale

Closes the loop with the existing admin review infrastructure. Gives
the model explicit permission to flag uncertainty without forcing a
confident-wrong answer. Over time the surfaced corrections become
training data for option C (the feedback loop).

---

## Issue 9 — Few-shot examples

### Current state

Zero examples in the prompt. Pure rules.

### Evidence

`docs/CLASSIFICATION_IMPROVEMENT_PLAN.md` (February 2026) proposed
few-shot learning with manually classified 50-100 examples. The work
was never completed. We now have 8,716 documented disagreements in
`etl/category_disagreements.json` — a ready-made gold-standard set.

### Proposed approach

After we agree on prompt rules, add 3-5 worked examples per
disambiguation boundary. Examples come from disagreement data — the
"corrected" classification is treated as ground truth. Format:

```
Example boundary: therapeutics vs basic_research

PROJECT:
  title: "Role of TGF-β signaling in pancreatic cancer metastasis"
  org: Memorial Sloan Kettering Cancer Center
  activity: R01CA245678
  phr: "..."

ANALYSIS:
  - "Role of X" is mechanism vocabulary
  - "in pancreatic cancer metastasis" is disease context, not therapeutic intent
  - Deliverable: knowledge about signaling, not a drug or treatment

CLASSIFICATION: basic_research (confidence 92)
```

Cover the highest-disagreement boundaries:
- therapeutics ↔ basic_research (3,011 + 3,218 corrections)
- biotools ↔ basic_research
- biotools ↔ infrastructure
- diagnostics ↔ biotools
- digital_health ↔ biotools

Target: ~20 total examples. Token cost is non-trivial (~3,000 tokens
added to every API call) but few-shot accuracy gains usually pay for it.

### Rationale

Concrete examples make abstract rules learnable. Disagreement data is
gold-standard ground truth we already have.

---

## Validation plan

Before merging any prompt change to canonical:

1. Pull a 500-row sample from `etl/category_disagreements.json` —
   projects where the previous classification was wrong and the
   correction is known.
2. Run the CURRENT prompt against the sample. Record agreement with
   corrected classification.
3. Run the PROPOSED prompt against the same sample. Record agreement.
4. Compare. The proposed prompt should agree more often AND not
   introduce new errors elsewhere.
5. Spot-check: pull 50 NEW projects (not in the disagreement set),
   classify with both prompts, eyeball for any obvious regressions.

Total validation cost: ~550 projects × $0.0003 × 2 prompts = ~$0.33.
Negligible.

If validation looks good, the new prompt is canonical. If validation
surfaces new errors, we iterate on the specific issue.

---

## Open questions for you

1. **Issue 1 vocabulary expansion** — should I be more aggressive
   (longer list, more modalities) or more conservative (only the most
   common patterns)? More keywords = more recall but risk of
   over-classification.
2. **Issue 8 review threshold** — is confidence ≤ 30 the right
   threshold for the review escape? Or should the model use a more
   nuanced signal (e.g., "set category to REVIEW and explain in
   reasoning")?
3. **Issue 9 token budget** — adding 20 examples will roughly double
   the prompt token count, which doubles per-classification cost.
   That's still ~$0.0006 per project = $90 to reclassify all 154K
   projects. Worth it? Or use fewer examples (10) at half the cost?
4. **What's missing** — anything you've seen in the data that the
   issues above don't cover?

Once you've marked things up, I'll roll the agreed-upon changes into
`etl/classifier.py` and run validation against the disagreement data.
