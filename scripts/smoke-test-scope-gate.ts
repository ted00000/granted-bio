/**
 * Smoke test for the Haiku scope-warning suppression gate.
 *
 * Runs the same prompt confirmSuppressionViaAgent uses against a
 * handful of real + adversarial cases. Passes when the target case
 * (MRD false positive) suppresses AND the adversarial cases fire.
 *
 * Kept as an ad-hoc script (not a test-runner test) because it makes
 * real Haiku calls — worth running before shipping any prompt change,
 * not on every CI run.
 */

import Anthropic from '@anthropic-ai/sdk'

interface CategoryContext {
  name: string
  projectCount?: number
}

interface Case {
  label: string
  topic: string
  emptyBucket: { dimension: string; category: string }
  siblingBucket: { dimension: string; category: string; projectCount: number }
  emptyDimensionCategories: CategoryContext[]
  siblingDimensionCategories: CategoryContext[]
  expectedSuppress: boolean
  why: string
}

const CASES: Case[] = [
  {
    label: 'REAL: MRD solid tumor monitoring (should suppress)',
    topic: 'MRD solid tumor monitoring',
    emptyBucket: {
      dimension: 'MRD Detection Assay and Analyte Class',
      category: 'MRD via Somatic Mutation ctDNA Profiling',
    },
    siblingBucket: {
      dimension: 'Clinical Application and Monitoring Context',
      category: 'Postoperative MRD Detection and Surgical Surveillance',
      projectCount: 14,
    },
    emptyDimensionCategories: [
      { name: 'MRD via Somatic Mutation ctDNA Profiling', projectCount: 0 },
      { name: 'Cell-Free DNA Methylation Profiling', projectCount: 9 },
      { name: 'Broad Cell-Free DNA and cfDNA Biology', projectCount: 11 },
      { name: 'Circulating Tumor DNA Quantification and Kinetics', projectCount: 20 },
      { name: 'Extracellular Vesicles and Exosomes', projectCount: 15 },
      { name: 'Non-coding RNA and Orphan RNA Biomarkers', projectCount: 6 },
      { name: 'Circulating Tumor Cells', projectCount: 10 },
      { name: 'Proteomic and Protein Biomarkers', projectCount: 3 },
      { name: 'Multi-Analyte and Multi-Omic Liquid Biopsy Panels', projectCount: 23 },
      { name: 'Fragmentomics and Epigenomic cfDNA Features', projectCount: 4 },
    ],
    siblingDimensionCategories: [
      { name: 'Postoperative MRD Detection and Surgical Surveillance', projectCount: 14 },
      { name: 'Early Cancer Detection and Screening', projectCount: 27 },
      { name: 'Treatment Response Monitoring', projectCount: 18 },
      { name: 'Immunotherapy and Checkpoint Inhibitor Monitoring', projectCount: 8 },
      { name: 'Recurrence Surveillance and Relapse Detection', projectCount: 7 },
      { name: 'Metastatic Disease Monitoring', projectCount: 4 },
      { name: 'Treatment Decision and Clinical Trial Guidance', projectCount: 9 },
      { name: 'Neoadjuvant Therapy and Downstaging Monitoring', projectCount: 3 },
      { name: 'Tumor Burden Quantification and Longitudinal Tracking', projectCount: 10 },
      { name: 'Prognostic Biomarker and Outcome Prediction', projectCount: 6 },
      { name: 'Resistance Mechanism and Clonal Evolution Tracking', projectCount: 4 },
    ],
    expectedSuppress: true,
    why: 'The empty bucket is one specific ctDNA-based MRD detection technique (tumor-informed personalized panels, Signatera-shape). The Assay dimension has 9 well-populated sibling buckets that cover the same methodology space under different labels — ctDNA quantification (20), methylation (9), fragmentomics (4), multi-analyte panels (23). MRD IS the topic being covered; the empty bucket is just an overly-narrow labeling.',
  },
  {
    label: 'ADVERSARIAL: cell-free antibody engineering (should FIRE)',
    topic: 'cell-free antibody engineering',
    emptyBucket: {
      dimension: 'Production & Expression Platform',
      category: 'Cell-Free Expression',
    },
    siblingBucket: {
      dimension: 'Production & Expression Platform',
      category: 'Cell-Free Expression',
      projectCount: 0,
    },
    emptyDimensionCategories: [
      { name: 'Cell-Free Expression', projectCount: 0 },
      { name: 'CHO Cell Production', projectCount: 1 },
      { name: 'E. coli Bacterial Expression', projectCount: 1 },
      { name: 'Yeast Display & Expression', projectCount: 0 },
      { name: 'HEK293 / Mammalian Transient Expression', projectCount: 0 },
      { name: 'Phage Display', projectCount: 0 },
      { name: 'Ribosome / mRNA Display', projectCount: 1 },
      { name: 'B Cell & Hybridoma', projectCount: 28 },
      { name: 'Stem Cell & iPSC-Derived Production', projectCount: 6 },
      { name: 'Self-Amplifying RNA / mRNA Platform', projectCount: 2 },
      { name: 'In Vivo B Cell Engineering', projectCount: 4 },
      { name: 'Continuous Evolution Platform', projectCount: 4 },
    ],
    siblingDimensionCategories: [],
    expectedSuppress: false,
    why: 'Cell-free expression means in-vitro protein synthesis without living cells. Every populated sibling (CHO, E. coli, Yeast, HEK293, B cell, stem cell, etc.) is CELL-BASED expression — the exact opposite. The sample legitimately misses the topic. Warning is correct.',
  },
  {
    label: 'ADVERSARIAL: MRD topic with hematologic sibling (should FIRE)',
    topic: 'MRD solid tumor monitoring',
    emptyBucket: {
      dimension: 'MRD Detection Assay and Analyte Class',
      category: 'MRD via Somatic Mutation ctDNA Profiling',
    },
    siblingBucket: {
      dimension: 'Clinical Application and Monitoring Context',
      category: 'MRD Detection in Hematologic Malignancies (Leukemia, Lymphoma)',
      projectCount: 22,
    },
    emptyDimensionCategories: [
      { name: 'MRD via Somatic Mutation ctDNA Profiling', projectCount: 0 },
      { name: 'Immunoglobulin/T-Cell Receptor Rearrangement Assays', projectCount: 15 },
      { name: 'Flow Cytometric Immunophenotyping', projectCount: 20 },
      { name: 'Bone Marrow Aspirate Cytology', projectCount: 8 },
    ],
    siblingDimensionCategories: [
      { name: 'MRD Detection in Hematologic Malignancies (Leukemia, Lymphoma)', projectCount: 22 },
      { name: 'Bone Marrow Transplant Response', projectCount: 12 },
      { name: 'Chemotherapy Response in AML', projectCount: 8 },
    ],
    expectedSuppress: false,
    why: 'Topic asks about SOLID TUMOR MRD. Both the empty-bucket dimension and the sibling dimension are entirely populated with HEMATOLOGIC MRD categories (leukemia, lymphoma, bone marrow, flow cytometry). Different clinical context — the sample is on-topic for hematologic MRD but not for what the user asked (solid tumor MRD).',
  },
  {
    label: 'ADVERSARIAL: 3D spatial multiomics with 3D-printing sibling (should FIRE)',
    topic: '3D spatial multiomics platforms',
    emptyBucket: {
      dimension: 'Multiomic Method',
      category: '3D Spatial Transcriptomics',
    },
    siblingBucket: {
      dimension: 'Sample Preparation Technology',
      category: '3D Printing for Microfluidic Device Fabrication',
      projectCount: 8,
    },
    emptyDimensionCategories: [
      { name: '3D Spatial Transcriptomics', projectCount: 0 },
      { name: 'Bulk RNA-seq', projectCount: 12 },
      { name: 'Single-Cell RNA-seq', projectCount: 15 },
      { name: 'Bulk Proteomics', projectCount: 6 },
    ],
    siblingDimensionCategories: [
      { name: '3D Printing for Microfluidic Device Fabrication', projectCount: 8 },
      { name: 'Manual Sample Preparation', projectCount: 20 },
      { name: 'Robotic Liquid Handling', projectCount: 5 },
    ],
    expectedSuppress: false,
    why: '3D spatial multiomics = imaging/transcriptomics with spatial coordinates. 3D printing = hardware fabrication. Only the token "3D" is shared; concepts are unrelated. Empty-bucket dim has 3 non-spatial multiomic methods; sibling dim is entirely about hardware.',
  },
  {
    label: 'ADVERSARIAL: liquid biopsy topic with liquid-crystal sibling (should FIRE)',
    topic: 'liquid biopsy for early cancer detection',
    emptyBucket: {
      dimension: 'Sample Type',
      category: 'Liquid Biopsy (Blood/Plasma)',
    },
    siblingBucket: {
      dimension: 'Detection Technology',
      category: 'Liquid Crystal Biosensor Platforms',
      projectCount: 5,
    },
    emptyDimensionCategories: [
      { name: 'Liquid Biopsy (Blood/Plasma)', projectCount: 0 },
      { name: 'Tissue Biopsy', projectCount: 25 },
      { name: 'Urine', projectCount: 3 },
      { name: 'Saliva', projectCount: 2 },
    ],
    siblingDimensionCategories: [
      { name: 'Liquid Crystal Biosensor Platforms', projectCount: 5 },
      { name: 'Immunohistochemistry', projectCount: 30 },
      { name: 'PCR-Based Assays', projectCount: 10 },
    ],
    expectedSuppress: false,
    why: 'Topic is blood-based cancer detection. Empty-bucket dim shows tissue biopsy dominates (25 vs 0 for blood/plasma) — the sample missed the topic. Sibling "liquid crystal biosensor" only shares the word "liquid."',
  },
]

async function runCase(client: Anthropic, c: Case): Promise<{ suppress: boolean; reasoning: string }> {
  const renderCategoryList = (cats: CategoryContext[]): string =>
    cats
      .map((x) => {
        const marker = x.name === c.emptyBucket.category ? '  ← EMPTY, matches topic head term' : ''
        return `  - ${x.name}: ${x.projectCount ?? 0} projects${marker}`
      })
      .join('\n')

  const emptyDimBlock = c.emptyDimensionCategories.length > 0
    ? `Categories in "${c.emptyBucket.dimension}" (the dimension containing the empty bucket):\n${renderCategoryList(c.emptyDimensionCategories)}`
    : `The empty category is "${c.emptyBucket.category}" in dimension "${c.emptyBucket.dimension}". (Sibling category listing unavailable.)`

  const siblingDimBlock = c.emptyBucket.dimension !== c.siblingBucket.dimension && c.siblingDimensionCategories.length > 0
    ? `\n\nAnother dimension, "${c.siblingBucket.dimension}", also has a category whose name carries the topic's head term — "${c.siblingBucket.category}" with ${c.siblingBucket.projectCount} projects. Full listing for that dimension:\n${renderCategoryList(c.siblingDimensionCategories)}`
    : ''

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `The user asked for a research intelligence report on this topic:
"${c.topic}"

The taxonomy classifier organized retrieved projects into categorized dimensions. One category — "${c.emptyBucket.category}" in the "${c.emptyBucket.dimension}" dimension — has ZERO projects classified into it, but its name matches the topic's most distinctive term. That is the scope-warning trigger.

${emptyDimBlock}${siblingDimBlock}

Question: given the full picture above, is the topic MEANINGFULLY COVERED by the retrieved projects, such that a scope-warning banner (telling the user "we didn't find your topic") would MISLEAD them?

Two failure modes to distinguish:
  A. The empty category is an over-narrow label for a concept that the sibling categories DO represent under different names. In this case the sample covers the topic well — the empty category is just a nomenclature artifact. Suppress the warning (sibling_covers_same_concept=true).
  B. The empty category names a specific technique/concept that genuinely isn't represented anywhere in the sample; the surrounding sibling categories are about different aspects that only share a word with the topic. In this case the user should be warned that their specific request may not be covered. Fire the warning (sibling_covers_same_concept=false).

Return your answer via the record_scope_judgment tool.

Default to sibling_covers_same_concept=false (fire the warning) if you are not confident. A false positive here (saying "same concept" when they are actually different) means the user gets a report that misses what they asked for, without any warning. A false negative (saying "different concepts" when they are actually the same) just shows a banner the user can read past.`,
      },
    ],
    tools: [
      {
        name: 'record_scope_judgment',
        description: 'Record whether the topic is meaningfully covered by the surrounding taxonomy, such that the scope-warning banner should be SUPPRESSED. Default to false (fire the warning) when uncertain.',
        input_schema: {
          type: 'object' as const,
          properties: {
            sibling_covers_same_concept: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['sibling_covers_same_concept', 'reasoning'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_scope_judgment' },
  })

  const toolUse = response.content.find((x) => x.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { suppress: false, reasoning: 'no tool_use' }
  }
  const input = toolUse.input as { sibling_covers_same_concept?: unknown; reasoning?: unknown }
  return {
    suppress: input.sibling_covers_same_concept === true,
    reasoning: typeof input.reasoning === 'string' ? input.reasoning : '(no reasoning)',
  }
}

async function main() {
  const client = new Anthropic()
  const results = await Promise.all(CASES.map((c) => runCase(client, c).then((r) => ({ c, r }))))

  let passes = 0
  let fails = 0
  for (const { c, r } of results) {
    const pass = r.suppress === c.expectedSuppress
    console.log(`\n${pass ? 'PASS' : 'FAIL'} — ${c.label}`)
    console.log(`  expected suppress=${c.expectedSuppress}, got suppress=${r.suppress}`)
    console.log(`  agent reasoning: ${r.reasoning}`)
    console.log(`  human rationale: ${c.why}`)
    if (pass) passes++
    else fails++
  }
  console.log(`\n=== ${passes}/${results.length} passed, ${fails} failed ===`)
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
