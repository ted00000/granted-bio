/**
 * White Space Analysis — the report section that identifies coverage gaps
 * within the topic scope of NIH-funded research.
 *
 * Design principle: DATA IS SOURCE. Counts and coverage numbers are
 * computed deterministically from the actual project abstracts (keyword
 * matching). The LLM only writes narrative around numbers it cannot
 * change. This eliminates the class of bug where the LLM says "only
 * one pancreatic cancer project" when there are actually eight in the
 * analyzed sample.
 *
 * Flow:
 *   1. Ask Claude Sonnet for 5 coverage dimensions + keyword sets that
 *      matter for this specific topic (topic-adaptive — different
 *      dimensions for liquid biopsy vs. brain organoids).
 *   2. Deterministically count projects in the analyzed sample matching
 *      each dimension×category via keyword scan of title+abstract.
 *   3. Cross-reference broader NIH RePORTER: for each category, count
 *      matching projects across the ENTIRE projects table. This
 *      distinguishes "sparse in topic slice" from "not an NIH funding
 *      area at all" — the former is the actionable opportunity.
 *   4. Rank white space opportunities algorithmically.
 *   5. Ask Claude Sonnet to write narrative wrapping the fixed numbers.
 *
 * NIH RePORTER scope caveat is a first-class citizen of the section
 * output — it's not an appendix note, it's rendered up front.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import type {
  CoverageCategory,
  CoverageDimension,
  ProjectItem,
  WhiteSpaceAnalysis,
  WhiteSpaceOpportunity,
} from './types'

// Sonnet is fine here — the narrative task rewards writing quality.
const MODEL = 'claude-sonnet-4-6'

// Cap categories per dimension. More categories = finer-grained gaps
// but also more broader-NIH queries downstream. 6-8 is the sweet spot.
const MAX_CATEGORIES_PER_DIMENSION = 8

// Cap total broader-NIH keyword lookups. 5 dimensions × 8 categories =
// 40 queries. Each is a single count query. Well under a second in
// aggregate against the projects table which has a project_title index.
const MAX_BROADER_QUERIES = 45

// Threshold used to classify "sparse-in-topic" opportunities. If a
// category has <8% sample share AND the broader NIH portfolio has
// >5× the count, that's a candidate white space.
const SPARSE_SHARE_THRESHOLD = 0.08
const BROADER_TO_SAMPLE_RATIO_THRESHOLD = 5

interface DimensionSchema {
  name: string
  description: string
  categories: Array<{
    name: string
    keywords: string[]
  }>
}

interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

/**
 * Public entry point. Given the analyzed set of projects and the report
 * topic, produce a full WhiteSpaceAnalysis ready for rendering.
 */
export async function generateWhiteSpaceAnalysis(
  topic: string,
  projects: ProjectItem[],
  usageTracker: UsageTracker,
): Promise<WhiteSpaceAnalysis> {
  const totalProjects = projects.length
  const totalFunding = projects.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  if (totalProjects === 0) {
    return emptyAnalysis()
  }

  const client = new Anthropic()

  // Step 1: topic-adaptive dimensions
  const schema = await inferCoverageDimensions(topic, projects, client, usageTracker)
  if (schema.length === 0) {
    return emptyAnalysis(totalProjects, totalFunding)
  }

  // Step 2: deterministic counting in the sample
  const dimensionsWithSampleCounts = schema.map((dim) =>
    computeSampleCoverage(dim, projects),
  )

  // Step 3: broader NIH cross-reference (deterministic keyword count
  // against the full projects table)
  const dimensionsWithBroader = await addBroaderNihCounts(dimensionsWithSampleCounts)

  // Step 4: algorithmic ranking of top opportunities before we ask the
  // LLM to interpret. Ranking is deterministic — the LLM cannot invent
  // an opportunity that wasn't identified from the data.
  const opportunities = rankOpportunities(dimensionsWithBroader, totalProjects)

  // Step 5: LLM narrative for overview + per-dimension + per-opportunity.
  // Narrative is grounded in the fixed data structure — the LLM sees
  // the counts and is instructed to reference them, not invent them.
  const withNarrative = await narrateCoverage(
    topic,
    dimensionsWithBroader,
    opportunities,
    totalProjects,
    totalFunding,
    client,
    usageTracker,
  )

  return {
    overview: withNarrative.overview,
    scopeNote: buildScopeNote(),
    dimensions: withNarrative.dimensions,
    topOpportunities: withNarrative.opportunities,
    totalProjects,
    totalFunding,
  }
}

/**
 * Step 1 — ask the LLM to identify what dimensions make sense for THIS
 * topic. Different topics need different audit axes (cancer type +
 * biofluid for liquid biopsy; disease target + platform for organoids;
 * mechanism + assay for drug discovery).
 */
async function inferCoverageDimensions(
  topic: string,
  projects: ProjectItem[],
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<DimensionSchema[]> {
  // Send a sample of project titles for topic-flavor context.
  const titleSample = projects
    .slice(0, 25)
    .map((p, i) => `[${i + 1}] ${p.title || '(untitled)'}`)
    .join('\n')

  const prompt = `You are designing a coverage-gap audit for a research intelligence report on:

  "${topic}"

Your task: identify exactly 5 coverage DIMENSIONS along which we can meaningfully audit what NIH-funded research covers vs. what's underrepresented within this topic scope. For each dimension, list 5-${MAX_CATEGORIES_PER_DIMENSION} CATEGORIES with keyword variants we'll use to match projects.

## SAMPLE PROJECT TITLES from the analyzed set (for context on what this topic actually covers in the NIH-funded portfolio)
${titleSample}

## GUIDELINES

- Dimensions should be ORTHOGONAL and MEANINGFUL for THIS topic. Not generic — topic-appropriate.
  - For cancer detection topics: cancer type, biofluid/sample, analyte class, methodology, translational stage, population — pick 5.
  - For organoid topics: source cell type, target disease, platform architecture, application, readout — pick 5.
  - For drug discovery topics: target class, therapeutic modality, disease area, screening approach, development stage — pick 5.
- Categories within a dimension should be MUTUALLY EXCLUSIVE-ISH (a project might match 2, but not 6).
- Keywords for each category should be 3-6 variants covering common synonyms, acronyms, and adjacent terms. Case-insensitive matching is used downstream.
- AVOID overly-common words that would match everything (e.g., don't put "cancer" as a keyword for a cancer category — everything in a cancer-detection topic will mention cancer).
- Categories should be SPECIFIC ENOUGH to reveal gaps. "Solid tumors" is too broad; "colorectal cancer", "pancreatic cancer", "gastric cancer" are useful.

## RESPONSE FORMAT — JSON only, no markdown code fences:

{
  "dimensions": [
    {
      "name": "Cancer Type",
      "description": "Primary cancer target of the project",
      "categories": [
        { "name": "Lung", "keywords": ["lung cancer", "NSCLC", "SCLC", "lung tumor", "lung adenocarcinoma"] },
        { "name": "Pancreatic", "keywords": ["pancreatic cancer", "PDAC", "pancreatic ductal", "pancreatic adenocarcinoma"] }
      ]
    }
  ]
}`

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') return []
    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed || !Array.isArray(parsed.dimensions)) return []

    // Sanitize
    return parsed.dimensions
      .slice(0, 5)
      .map((d: unknown) => {
        const dim = d as { name?: string; description?: string; categories?: unknown }
        return {
          name: (dim.name || '').trim(),
          description: (dim.description || '').trim(),
          categories: Array.isArray(dim.categories)
            ? dim.categories
                .slice(0, MAX_CATEGORIES_PER_DIMENSION)
                .map((c: unknown) => {
                  const cat = c as { name?: string; keywords?: unknown }
                  return {
                    name: (cat.name || '').trim(),
                    keywords: Array.isArray(cat.keywords)
                      ? cat.keywords
                          .map((k: unknown) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
                          .filter((k: string) => k.length > 0)
                      : [],
                  }
                })
                .filter((c: { name: string; keywords: string[] }) => c.name && c.keywords.length > 0)
            : [],
        }
      })
      .filter((d: DimensionSchema) => d.name && d.categories.length > 0)
  } catch (err) {
    console.error('[White Space] Failed to infer dimensions:', err)
    return []
  }
}

/**
 * Step 2 — deterministic keyword count against the analyzed set.
 * A project matches a category if ANY of the category's keywords appears
 * in the project's title or abstract (case-insensitive). A project can
 * match multiple categories — we treat that as multi-topical reality.
 */
function computeSampleCoverage(
  schema: DimensionSchema,
  projects: ProjectItem[],
): CoverageDimension {
  // Build searchable text once per project — lowercased title + abstract.
  const searchables = projects.map((p) => ({
    project: p,
    text: `${p.title || ''} ${p.abstract || ''}`.toLowerCase(),
  }))

  const categories: CoverageCategory[] = schema.categories.map((cat) => {
    const matched = searchables.filter((s) =>
      cat.keywords.some((kw) => s.text.includes(kw)),
    )
    const projectCount = matched.length
    const fundingTotal = matched.reduce((sum, s) => sum + (s.project.total_cost || 0), 0)
    const projectExamples = matched
      .slice(0, 3)
      .map((s) => s.project.project_number || s.project.application_id)
      .filter((v): v is string => !!v)
    return {
      name: cat.name,
      keywords: cat.keywords,
      projectCount,
      fundingTotal,
      broaderNihCount: 0, // filled in step 3
      projectExamples,
    }
  })

  // Count projects that match at least one category (matched) vs. none
  // (unclassified — the "other" bucket for this dimension). A project
  // matches the dimension if it matches any category within it.
  const anyMatched = searchables.filter((s) =>
    schema.categories.some((cat) => cat.keywords.some((kw) => s.text.includes(kw))),
  ).length

  return {
    name: schema.name,
    description: schema.description,
    categories,
    totalMatched: anyMatched,
    totalUnclassified: projects.length - anyMatched,
    narrative: '', // filled in step 5
  }
}

/**
 * Step 3 — for each category, count matching projects across the FULL
 * projects table (not just the topic slice). Uses PostgREST OR filter
 * with ilike patterns on title. Deterministic and cheap.
 *
 * Note: we search titles only in the broader query — searching abstracts
 * across all projects would be expensive. Title matches are conservative;
 * the true broader count is likely higher. This is fine for the
 * comparison ratio we care about.
 */
async function addBroaderNihCounts(dimensions: CoverageDimension[]): Promise<CoverageDimension[]> {
  let queryCount = 0

  for (const dim of dimensions) {
    for (const cat of dim.categories) {
      if (queryCount >= MAX_BROADER_QUERIES) {
        cat.broaderNihCount = -1 // sentinel for "not queried"
        continue
      }
      // PostgREST .or() joins keyword ilike patterns.
      // Escape percent signs and commas since they're special to PostgREST.
      const patterns = cat.keywords
        .map((k) => k.replace(/,/g, ' ').trim())
        .filter((k) => k.length > 0)
        .map((k) => `title.ilike.%${k}%`)
      if (patterns.length === 0) {
        cat.broaderNihCount = 0
        continue
      }
      try {
        const { count, error } = await supabaseAdmin
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .or(patterns.join(','))
        if (error) {
          console.warn(`[White Space] Broader count error for ${cat.name}:`, error.message)
          cat.broaderNihCount = 0
        } else {
          cat.broaderNihCount = count ?? 0
        }
        queryCount++
      } catch (err) {
        console.warn(`[White Space] Broader count exception for ${cat.name}:`, err)
        cat.broaderNihCount = 0
      }
    }
  }

  return dimensions
}

/**
 * Step 4 — deterministic ranking of opportunities.
 *
 * A category qualifies as an "opportunity" if it meets one of these
 * rule-based signals. The LLM writes rationale for the top 5, but
 * cannot invent opportunities not surfaced by these rules.
 */
function rankOpportunities(
  dimensions: CoverageDimension[],
  totalProjects: number,
): WhiteSpaceOpportunity[] {
  const candidates: WhiteSpaceOpportunity[] = []

  for (const dim of dimensions) {
    for (const cat of dim.categories) {
      const sampleShare = totalProjects > 0 ? cat.projectCount / totalProjects : 0
      const broaderCount = cat.broaderNihCount

      let signal: WhiteSpaceOpportunity['gapSignal'] | null = null

      if (cat.projectCount === 0 && broaderCount > 20) {
        // Not in the topic slice at all, but present in broader NIH portfolio
        signal = 'absent-in-topic'
      } else if (
        sampleShare < SPARSE_SHARE_THRESHOLD &&
        broaderCount > 0 &&
        broaderCount / Math.max(cat.projectCount, 1) >= BROADER_TO_SAMPLE_RATIO_THRESHOLD
      ) {
        // Sparse in the topic slice compared to broader NIH activity —
        // the strongest signal for actionable white space.
        signal = 'sample-under-broader'
      } else if (cat.projectCount > 0 && sampleShare < SPARSE_SHARE_THRESHOLD) {
        // Present but sparse.
        signal = 'sparse-in-topic'
      }

      if (signal) {
        candidates.push({
          dimensionName: dim.name,
          categoryName: cat.name,
          sampleCount: cat.projectCount,
          sampleShare,
          broaderNihCount: broaderCount,
          gapSignal: signal,
          rationale: '', // filled in step 5
        })
      }
    }
  }

  // Sort: absent-in-topic first (strongest signal), then by broader/sample
  // ratio (most-underrepresented in the topic slice), then by absolute
  // broader count (biggest addressable population).
  candidates.sort((a, b) => {
    const priority = (s: WhiteSpaceOpportunity['gapSignal']) =>
      s === 'absent-in-topic' ? 3 : s === 'sample-under-broader' ? 2 : 1
    const pDiff = priority(b.gapSignal) - priority(a.gapSignal)
    if (pDiff !== 0) return pDiff
    const ratioA = a.broaderNihCount / Math.max(a.sampleCount, 1)
    const ratioB = b.broaderNihCount / Math.max(b.sampleCount, 1)
    if (ratioA !== ratioB) return ratioB - ratioA
    return b.broaderNihCount - a.broaderNihCount
  })

  return candidates.slice(0, 5)
}

/**
 * Step 5 — LLM narrates around the fixed data. It receives the exact
 * counts and is instructed to reference them. It cannot invent new
 * counts or categories — the data structure is passed back verbatim
 * except for the narrative fields.
 */
async function narrateCoverage(
  topic: string,
  dimensions: CoverageDimension[],
  opportunities: WhiteSpaceOpportunity[],
  totalProjects: number,
  totalFunding: number,
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<{
  overview: string
  dimensions: CoverageDimension[]
  opportunities: WhiteSpaceOpportunity[]
}> {
  const dimensionSummaries = dimensions
    .map((dim) => {
      const catRows = dim.categories
        .map((c) => {
          const share = totalProjects > 0 ? (c.projectCount / totalProjects) * 100 : 0
          return `  - ${c.name}: ${c.projectCount} project${c.projectCount === 1 ? '' : 's'} (${share.toFixed(1)}% of sample), $${(c.fundingTotal / 1_000_000).toFixed(1)}M, broader NIH: ${c.broaderNihCount === -1 ? 'n/a' : c.broaderNihCount}`
        })
        .join('\n')
      return `### ${dim.name} (${dim.description})
Matched: ${dim.totalMatched} of ${totalProjects} projects. Unclassified: ${dim.totalUnclassified}.
${catRows}`
    })
    .join('\n\n')

  const opportunitySummaries = opportunities
    .map((op, i) => {
      return `${i + 1}. ${op.categoryName} (${op.dimensionName})
   sample: ${op.sampleCount} projects (${(op.sampleShare * 100).toFixed(1)}%)
   broader NIH: ${op.broaderNihCount}
   signal: ${op.gapSignal}`
    })
    .join('\n\n')

  const prompt = `You are writing the White Space Analysis section for an intelligence report on:

  "${topic}"

The COVERAGE DATA below was computed deterministically from the actual project titles and abstracts in the analyzed sample. These numbers are FACTS — reference them exactly, do NOT round or approximate in ways that change the story, and do NOT invent counts that aren't shown.

## SCOPE
- ${totalProjects} projects analyzed, $${(totalFunding / 1_000_000).toFixed(1)}M in NIH funding
- "Broader NIH" counts reflect NIH RePORTER matches on project title only (not abstracts) — a conservative floor. Actual broader NIH activity may be higher.

## COVERAGE DATA
${dimensionSummaries}

## RANKED WHITE SPACE OPPORTUNITIES
${opportunitySummaries || '(no strong opportunities identified from the data)'}

## YOUR TASK

Write narrative text that will be paired with the numbers above. Return JSON only.

For the OVERVIEW field: 3-4 sentences that:
- Frame the coverage picture across the ${dimensions.length} dimensions (what's densely funded, what's thin).
- Reference specific numbers (e.g., "45 of ${totalProjects} projects target lung cancer while pancreatic appears in 10").
- Acknowledge the NIH RePORTER scope — this is publicly-searchable federal funding, the largest portion of non-dilutive US biomedical grants, but not the full R&D universe (private industry, international, non-NIH federal are excluded).

For each DIMENSION's narrative field: 2-3 sentences interpreting THAT dimension's distribution. Call out concentration (top category share), meaningful clusters, and any striking absences. Reference actual category counts from the data.

For each OPPORTUNITY's rationale field: 2-3 sentences answering "why might this white space matter." Consider:
- If sample count is zero or near-zero but broader NIH count is substantial: the topic slice has a gap that the broader research community is exploring — potential opportunity to bring adjacent methodology.
- If sample count is nonzero but small: underserved within the topic focus specifically.
- Reference actual counts. Do not overstate — say "underrepresented" not "abandoned."

FORMATTING: Do NOT use em dashes (—). Use regular hyphens or rewrite sentences.

Return JSON only, exactly this shape:
{
  "overview": "...",
  "dimensionNarratives": [
    { "name": "Cancer Type", "narrative": "..." },
    { "name": "Biofluid", "narrative": "..." }
  ],
  "opportunityRationales": [
    { "categoryName": "Pancreatic", "dimensionName": "Cancer Type", "rationale": "..." }
  ]
}`

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') {
      return { overview: '', dimensions, opportunities }
    }
    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { overview: '', dimensions, opportunities }
    }
    const parsed = JSON.parse(jsonMatch[0])

    // Merge narrative back into the fixed data structure. The LLM cannot
    // change the numbers; it only fills in narrative fields.
    const dimNarrativeMap = new Map<string, string>()
    if (Array.isArray(parsed.dimensionNarratives)) {
      for (const dn of parsed.dimensionNarratives) {
        if (dn?.name && typeof dn.narrative === 'string') {
          dimNarrativeMap.set(dn.name.toLowerCase(), dn.narrative)
        }
      }
    }
    const dimensionsOut = dimensions.map((d) => ({
      ...d,
      narrative: dimNarrativeMap.get(d.name.toLowerCase()) || '',
    }))

    const rationaleMap = new Map<string, string>()
    if (Array.isArray(parsed.opportunityRationales)) {
      for (const or of parsed.opportunityRationales) {
        if (or?.categoryName && or?.dimensionName && typeof or.rationale === 'string') {
          const key = `${or.dimensionName.toLowerCase()}|${or.categoryName.toLowerCase()}`
          rationaleMap.set(key, or.rationale)
        }
      }
    }
    const opportunitiesOut = opportunities.map((op) => ({
      ...op,
      rationale:
        rationaleMap.get(`${op.dimensionName.toLowerCase()}|${op.categoryName.toLowerCase()}`) || '',
    }))

    return {
      overview: typeof parsed.overview === 'string' ? parsed.overview : '',
      dimensions: dimensionsOut,
      opportunities: opportunitiesOut,
    }
  } catch (err) {
    console.error('[White Space] Narrate step failed:', err)
    return { overview: '', dimensions, opportunities }
  }
}

function buildScopeNote(): string {
  return (
    'This analysis maps what NIH-funded research covers vs. gaps within the topic scope. ' +
    'NIH RePORTER represents the largest publicly-searchable portion of non-dilutive US biomedical grants — a strong signal for federal research investment priorities. ' +
    'Private R&D, international research, and non-NIH federal funding (DoD, DARPA, industry-sponsored) are not captured here. ' +
    'Counts are derived by keyword matching against project titles and abstracts; a project can appear in multiple categories.'
  )
}

function emptyAnalysis(totalProjects: number = 0, totalFunding: number = 0): WhiteSpaceAnalysis {
  return {
    overview: '',
    scopeNote: buildScopeNote(),
    dimensions: [],
    topOpportunities: [],
    totalProjects,
    totalFunding,
  }
}
