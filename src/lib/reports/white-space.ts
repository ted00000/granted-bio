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
import { normalizeConfidenceTagSpacing } from './confidence-tags'
import type {
  CoverageCategory,
  CoverageDimension,
  ProjectItem,
  WhiteSpaceAnalysis,
  WhiteSpaceOpportunity,
} from './types'

// Sonnet is fine here — the narrative task rewards writing quality.
const MODEL = 'claude-sonnet-4-6'

// Cap categories per dimension. Wider than the earlier 8 because
// liquid-biopsy and other broad topics have genuine long tails of
// cancer sites, methodologies, and biofluids — under-covering them was
// producing >70% "unclassified" tails and hiding real gaps.
const MAX_CATEGORIES_PER_DIMENSION = 12

// Cap total broader-NIH keyword lookups. 5 dimensions × 12 categories =
// 60 queries. Each is a single count query against the projects table
// (indexed on project_title). Runs in a second or two aggregate.
const MAX_BROADER_QUERIES = 65

// Reject keywords shorter than this — anything 2 chars or less is
// almost always a false-positive magnet (e.g., "ev" matches "level",
// "development", "several", "evaluate" and inflates coverage 5x).
const MIN_KEYWORD_LENGTH = 3

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

/**
 * Topic scope for broader-NIH cross-reference. Broader-NIH counts used
 * to be raw keyword prevalence across the whole projects table — for
 * "machine learning" this yielded 1,700+ matches spanning ALL of NIH
 * biomedical research, and comparing that against 6 liquid-biopsy
 * projects was an apples-to-oranges category error (Fable 5 audit,
 * 2026-07-09). To make the comparison meaningful, we AND the keyword
 * search with a topic-scope filter: the broader-NIH search now only
 * counts projects that also match at least one topic-scope term.
 *
 * The LLM produces the scope terms during dimension inference — they
 * define the topic frame ("cancer", "tumor", "oncology" for a cancer
 * topic; "drug discovery", "small molecule", "screening" for a drug
 * discovery topic, etc.).
 */
interface TopicScope {
  scopeKeywords: string[]
  scopeLabel: string // e.g., "cancer research" for a cancer topic
}

/**
 * Word-boundary keyword match against pre-lowercased text.
 *
 * Multi-word phrases and hyphenated tokens use substring match (they're
 * already specific enough — "extracellular vesicle" or "ev-based" won't
 * accidentally match inside another word). Single-token keywords require
 * a word boundary on both sides so short acronyms like "ngs" or "cfdna"
 * don't hit substrings of unrelated words.
 *
 * Keywords shorter than MIN_KEYWORD_LENGTH are silently rejected —
 * they're always false-positive magnets.
 */
function matchesKeyword(loweredText: string, keyword: string): boolean {
  if (!keyword || keyword.length < MIN_KEYWORD_LENGTH) return false
  const hasSeparator = /[\s\-/]/.test(keyword)
  if (hasSeparator) {
    return loweredText.includes(keyword)
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b${escaped}\\b`)
  return re.test(loweredText)
}

/** Escape a keyword for use in a Postgres regex (~* operator). */
function escapeForPgRegex(kw: string): string {
  return kw.replace(/[.^$*+?()[\]{}|\\]/g, '\\$&')
}

/**
 * Attempt to fix a JSON string that was truncated by the LLM hitting
 * max_tokens mid-generation. Common truncation patterns:
 *   - Cut inside a string literal: '"lung can|<cut>'
 *   - Cut inside an array of keywords: '["a", "b", |<cut>'
 *   - Cut inside a category object: '{"name": "X", |<cut>'
 *   - Cut inside the dimensions array: '{"dimensions": [ {...}, {..|<cut>'
 *
 * Strategy: walk backwards from the end, trimming until we're at a
 * clean boundary (closing brace/bracket followed by comma or another
 * closer), then append whatever closing brackets we need to balance
 * the structure. Never perfect — we may lose the last dimension or
 * category — but produces valid JSON we can parse instead of nothing.
 */
function trySalvageTruncatedJson(str: string): string | null {
  if (!str || str.length < 100) return null
  // Trim any trailing garbage after the last comma-terminated element
  // in the outermost array/object we can find.
  const stack: string[] = []
  let inString = false
  let escaped = false
  let lastCleanCut = -1
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '{' || c === '[') stack.push(c)
    else if (c === '}') {
      if (stack[stack.length - 1] === '{') stack.pop()
      if (stack.length === 1) lastCleanCut = i
    } else if (c === ']') {
      if (stack[stack.length - 1] === '[') stack.pop()
      if (stack.length === 1) lastCleanCut = i
    } else if (c === ',' && stack.length === 2) {
      // comma at depth 2 means "we just closed an item in the outer array"
      lastCleanCut = i
    }
  }
  if (lastCleanCut < 0) return null
  // Truncate to the last clean cut point.
  let candidate = str.slice(0, lastCleanCut + 1)
  // Remove trailing comma if present (invalid JSON before closing bracket).
  candidate = candidate.replace(/,\s*$/, '')
  // Rebuild the closing brackets from the stack we tracked.
  stack.length = 0
  inString = false
  escaped = false
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' && stack[stack.length - 1] === '{') stack.pop()
    else if (c === ']' && stack[stack.length - 1] === '[') stack.pop()
  }
  // Close remaining open brackets in reverse order.
  while (stack.length > 0) {
    const open = stack.pop()
    candidate += open === '{' ? '}' : ']'
  }
  return candidate
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
  persona: 'researcher' | 'investor' = 'researcher',
): Promise<WhiteSpaceAnalysis> {
  const totalProjects = projects.length
  const totalFunding = projects.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  if (totalProjects === 0) {
    return emptyAnalysis()
  }

  const client = new Anthropic()

  // Step 1: topic-adaptive dimensions + topic scope for broader-NIH filtering
  const { dimensions: schema, scope } = await inferCoverageDimensions(topic, projects, client, usageTracker)
  if (schema.length === 0) {
    return emptyAnalysis(totalProjects, totalFunding)
  }

  // Step 2: deterministic counting in the sample
  const dimensionsWithSampleCounts = schema.map((dim) =>
    computeSampleCoverage(dim, projects),
  )

  // Step 2b: two-pass category expansion. For any dimension with a high
  // unclassified rate, ask the LLM to look at the unclassified titles
  // directly and propose additional categories that would classify them.
  // Then re-count the sample against the expanded category set. This
  // catches the class of bug where the initial category proposal misses
  // real categories present in the data (e.g., no "Bladder" or "Ovarian"
  // category despite six projects mentioning each).
  const dimensionsRefined = await expandUnclassifiedCategories(
    topic,
    dimensionsWithSampleCounts,
    projects,
    client,
    usageTracker,
  )

  // Step 3: broader NIH cross-reference (deterministic keyword count
  // against the full projects table), scope-filtered to the topic frame
  // so we're comparing apples-to-apples (e.g., "metabolomics IN cancer
  // research" not "metabolomics anywhere in biomedicine").
  const dimensionsWithBroader = await addBroaderNihCounts(dimensionsRefined, scope)

  // Step 3b: compute the scope-universe count — the total number of
  // NIH projects matching the topic-scope filter, independent of any
  // category. Surfaces the base rate: a category count of 82 out of
  // ~4,000 scope-matching projects means something different than 82
  // out of 154K raw NIH projects, and readers should see the
  // denominator up front. See user feedback 2026-07-10 for the concern.
  const scopeUniverseCount = await countScopeUniverse(scope)

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
    persona,
  )

  return {
    overview: withNarrative.overview,
    scopeNote: buildScopeNote(scope.scopeLabel),
    dimensions: withNarrative.dimensions,
    topOpportunities: withNarrative.opportunities,
    totalProjects,
    totalFunding,
    strategicImplications: withNarrative.strategicImplications,
    broaderNihScopeLabel: scope.scopeLabel || undefined,
    scopeUniverseCount,
  }
}

/**
 * Count the NIH projects matching just the topic-scope filter. This is
 * the denominator for every "Broader NIH" cell in the coverage tables.
 * Returns null when the scope filter is inactive or the query fails —
 * callers should render the number only when it's non-null.
 */
async function countScopeUniverse(scope: TopicScope): Promise<number | null> {
  const scopePatterns: string[] = []
  for (const kwRaw of scope.scopeKeywords) {
    const kw = kwRaw.replace(/,/g, ' ').trim()
    if (kw.length < MIN_KEYWORD_LENGTH) continue
    const escaped = escapeForPgRegex(kw)
    const hasSeparator = /[\s\-/]/.test(kw)
    const regex = hasSeparator ? escaped : `\\m${escaped}\\M`
    scopePatterns.push(`title.imatch.${regex}`)
  }
  if (scopePatterns.length === 0) return null
  try {
    const { count, error } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .or(scopePatterns.join(','))
    if (error) {
      console.warn('[White Space] Scope-universe count error:', JSON.stringify(error))
      return null
    }
    return count ?? null
  } catch (err) {
    console.warn('[White Space] Scope-universe count exception:', err)
    return null
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
): Promise<{ dimensions: DimensionSchema[]; scope: TopicScope }> {
  // Send a sample of project titles for topic-flavor context.
  const titleSample = projects
    .slice(0, 25)
    .map((p, i) => `[${i + 1}] ${p.title || '(untitled)'}`)
    .join('\n')

  const prompt = `You are designing a coverage-gap audit for a research intelligence report on:

  "${topic}"

Your task: identify exactly 5 coverage DIMENSIONS along which we can meaningfully audit what NIH-funded research covers vs. what's underrepresented within this topic scope. For each dimension, list 8-${MAX_CATEGORIES_PER_DIMENSION} CATEGORIES with keyword variants we'll use to match projects.

## SAMPLE PROJECT TITLES from the analyzed set (for context on what this topic actually covers in the NIH-funded portfolio)
${titleSample}

## GUIDELINES

- Dimensions should be ORTHOGONAL and MEANINGFUL for THIS topic. Not generic — topic-appropriate.
  - For cancer detection topics: cancer type, biofluid/sample, analyte class, methodology, translational stage, population — pick 5.
  - For organoid topics: source cell type, target disease, platform architecture, application, readout — pick 5.
  - For drug discovery topics: target class, therapeutic modality, disease area, screening approach, development stage — pick 5.
- Categories within a dimension should be MUTUALLY EXCLUSIVE-ISH (a project might match 2, but not 6).
- BE EXHAUSTIVE within each dimension. Aim for 10-12 categories, not 5-6. If a dimension is "Cancer Type" for an oncology topic, include the full common set: Lung, Breast, Prostate, Colorectal, Pancreatic, Ovarian, Bladder, Head and Neck, Liver/Hepatocellular, Glioma/Brain, Lymphoma, Leukemia/Myeloma, Melanoma, Cervical, Endometrial, Kidney/Renal, Gastric — not just the top 5-8. Missing categories create false "unclassified" bins that hide real coverage.
- Categories should be SPECIFIC ENOUGH to reveal gaps. "Solid tumors" is too broad; "colorectal cancer", "pancreatic cancer", "gastric cancer" are useful.
- **CATEGORY NAMING — NO AMBIGUOUS "GENERAL" / "MULTI-X" / "OTHER" LABELS.** A category name must clearly describe what its keyword set actually catches, not sound like a superset. Bad name: "Non-plasma Biofluids (general / multi-fluid)" — reads to a reader as "all non-plasma work" (superset) when the keyword set only catches meta-framed cross-fluid studies. Good name: "Multi-Fluid Panel Studies" or "Cross-Fluid Meta-Framing." Similarly avoid "Cancer Type (general)," "Methodology (other)," or any name using the words "general," "generic," "misc," or "other" as the primary descriptor. If the category catches meta-framed work, name it after the meta-framing directly. If it truly is a "leftover" bucket you can't name specifically, DROP IT — leftover buckets don't produce actionable opportunities.

## KEYWORD RULES (critical for accurate counting)

- Provide 5-10 keyword variants per category. INCLUDE synonyms, common abbreviations, disease subtypes, and adjective/noun variants.
- MINIMUM keyword length: ${MIN_KEYWORD_LENGTH} characters. Never give a 2-character keyword like "ev" or "ai" — they match unrelated words ("level", "development", "brain") and inflate counts by 5x or more. Even for genuine 2-letter acronyms, use the expanded form or a 3+ char variant ("evs", "ev-based", "extracellular vesicle").
- Keywords are matched with WORD BOUNDARIES for single tokens, so include the FULL specific term. "cfdna" as a keyword will match "cfdna" or "cfDNA" but not "cell-free DNA" — include both variants explicitly.
- For hyphenated or multi-word keywords, they match as substrings — that's fine since they're already specific.
- AVOID overly-common words. "cancer" alone in a cancer-detection topic matches everything and reveals nothing.
- DO NOT rely on partial matches. If a category needs to catch "hepatocellular carcinoma" write out "hepatocellular", "hcc", "liver cancer", "hepatoma" as separate keywords — don't rely on "hep" matching all of them.

## TOPIC SCOPE (REQUIRED) — define the field boundary

Also return a "topicScope" object with:
- scopeKeywords: 10-16 keywords that define the OVERALL topic frame (not category-specific — topic-wide). These will be used to filter broader-NIH cross-reference queries. CRITICAL: NIH project titles for topic-relevant work often DON'T repeat the canonical topic word. A cancer cfDNA project might be titled "Circulating Cell-Free DNA as a Personalized Biomarker for Glioblastoma" — no "cancer" in the title, but clearly cancer-relevant. To capture these, include disease-name surrogates AND topic-adjacent methodology terms that co-appear in relevant titles.
- scopeLabel: 2-4 word human-readable label for the scope, used in report copy (e.g., "cancer research" for a cancer topic, "drug discovery" for a drug-discovery topic).

Scope keywords should be broad enough to include work in the general area but narrow enough to exclude clearly-unrelated research. Aim for 10-16 keywords covering: canonical topic terms, MAJOR disease-name surrogates (specific cancer types for a cancer topic; specific brain regions for a neuroscience topic), and topic-adjacent methodology terms that consistently appear in relevant titles.

For:
- "liquid biopsy for early cancer detection" → scopeKeywords: ["cancer", "tumor", "oncology", "neoplasm", "carcinoma", "malignant", "leukemia", "lymphoma", "melanoma", "sarcoma", "glioma", "adenoma", "liquid biopsy", "biomarker", "ctdna", "circulating tumor"], scopeLabel: "cancer research"
- "brain organoid electrophysiology" → scopeKeywords: ["organoid", "brain", "neural", "neuron", "cerebral", "cortical", "hippocampal", "cortex", "neurodevelopment", "synapse", "ipsc", "stem cell"], scopeLabel: "neural/organoid research"
- "monoclonal antibody production" → scopeKeywords: ["antibody", "antibodies", "immunoglobulin", "mab", "monoclonal", "igg", "biologics", "adc", "bispecific", "fc-region"], scopeLabel: "antibody research"

Use word-boundary-safe terms (≥${MIN_KEYWORD_LENGTH} chars).

## RESPONSE FORMAT — JSON only, no markdown code fences:

{
  "topicScope": {
    "scopeKeywords": ["cancer", "tumor", "oncology", "neoplasm"],
    "scopeLabel": "cancer research"
  },
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
      // 10000: r26 hit exactly the 6500 ceiling and truncated mid-array,
      // dropping the entire White Space section to empty. Once the LLM
      // is producing 6500 tokens the response is likely to be even
      // higher next time (Sonnet's outputs are variance-prone at scale).
      // Real headroom of 10K keeps the ceiling from being the limiting
      // factor. Sonnet still only generates what's needed.
      max_tokens: 10000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') return { dimensions: [], scope: { scopeKeywords: [], scopeLabel: '' } }
    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { dimensions: [], scope: { scopeKeywords: [], scopeLabel: '' } }

    // Salvage parse — if the JSON is truncated (r26 hit exactly the
    // 6500 max_tokens cap and lost the entire section), extract what
    // we can via regex rather than dropping the whole result. Better
    // to render a partial White Space section than none at all.
    let parsed: {
      topicScope?: { scopeKeywords?: unknown; scopeLabel?: unknown }
      dimensions?: unknown[]
    } = {}
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.warn('[White Space] Dimension JSON parse failed, attempting salvage:', parseErr)
      // Attempt to close the JSON by trimming trailing incomplete tokens
      // and appending closing brackets. Common truncation pattern: cut
      // inside a keyword string, inside a category object, or inside
      // the dimensions array.
      const salvaged = trySalvageTruncatedJson(jsonMatch[0])
      if (salvaged) {
        try {
          parsed = JSON.parse(salvaged)
          console.warn('[White Space] Salvage parse succeeded — some dimensions may be missing')
        } catch {
          console.warn('[White Space] Salvage attempt also failed')
        }
      }
    }
    if (!parsed || !Array.isArray(parsed.dimensions)) return { dimensions: [], scope: { scopeKeywords: [], scopeLabel: '' } }

    // Extract topic scope from LLM response, sanitize to min-length keywords
    const rawScope = parsed.topicScope as { scopeKeywords?: unknown; scopeLabel?: unknown } | undefined
    const scope: TopicScope = {
      scopeKeywords: Array.isArray(rawScope?.scopeKeywords)
        ? (rawScope.scopeKeywords as unknown[])
            .map((k) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
            .filter((k) => k.length >= MIN_KEYWORD_LENGTH)
        : [],
      scopeLabel: typeof rawScope?.scopeLabel === 'string' ? rawScope.scopeLabel.trim() : '',
    }

    // Sanitize — enforce keyword min-length here as a defensive filter
    // in case the LLM ignores the prompt instruction. Anything <3 chars
    // gets dropped, and we log the drops so we can tune the prompt.
    const droppedKeywords: string[] = []
    const dimensions = parsed.dimensions
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
                  const raw = Array.isArray(cat.keywords)
                    ? cat.keywords
                        .map((k: unknown) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
                        .filter((k: string) => k.length > 0)
                    : []
                  const kept: string[] = []
                  for (const k of raw) {
                    if (k.length < MIN_KEYWORD_LENGTH) {
                      droppedKeywords.push(`${cat.name}:${k}`)
                    } else {
                      kept.push(k)
                    }
                  }
                  return {
                    name: (cat.name || '').trim(),
                    keywords: kept,
                  }
                })
                .filter((c: { name: string; keywords: string[] }) => c.name && c.keywords.length > 0)
            : [],
        }
      })
      .filter((d: DimensionSchema) => d.name && d.categories.length > 0)

    if (droppedKeywords.length > 0) {
      console.warn(
        `[White Space] Dropped ${droppedKeywords.length} too-short keywords:`,
        droppedKeywords.slice(0, 10).join(', '),
      )
    }
    return { dimensions, scope }
  } catch (err) {
    console.error('[White Space] Failed to infer dimensions:', err)
    return { dimensions: [], scope: { scopeKeywords: [], scopeLabel: '' } }
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
      cat.keywords.some((kw) => matchesKeyword(s.text, kw)),
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
    schema.categories.some((cat) => cat.keywords.some((kw) => matchesKeyword(s.text, kw))),
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
 * Step 2b — second-pass category expansion.
 *
 * The initial LLM proposal often misses categories present in the data
 * (r18 audit showed "Cancer Type" had no Ovarian/Bladder/Glioma buckets
 * despite ~19 projects mentioning those in titles). We fix this by
 * showing the LLM the actual unclassified titles for each dimension
 * with a high unclassified rate and asking it to propose additional
 * categories. Adds ~1 LLM call per high-unclassified dimension (~$0.02).
 *
 * A dimension skips second-pass if its unclassified rate is below the
 * threshold — a lot of methodology projects genuinely don't state a
 * platform in title/abstract, and forcing categories on them would
 * introduce noise rather than signal.
 */
const SECOND_PASS_UNCLASSIFIED_THRESHOLD = 0.2 // 20%+

async function expandUnclassifiedCategories(
  topic: string,
  dimensions: CoverageDimension[],
  projects: ProjectItem[],
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<CoverageDimension[]> {
  // Kick off ALL second-pass LLM calls in parallel. The prior version
  // ran them sequentially in a for-loop — with 3-5 dimensions each
  // hitting a 30-60s LLM call, that alone could exceed the Vercel
  // 300s function budget and cause the report to hang silently.
  const secondPassPromises = dimensions.map(async (dim) => {
    const total = dim.totalMatched + dim.totalUnclassified
    const unclassifiedRate = total > 0 ? dim.totalUnclassified / total : 0
    if (
      unclassifiedRate < SECOND_PASS_UNCLASSIFIED_THRESHOLD ||
      dim.categories.length >= MAX_CATEGORIES_PER_DIMENSION
    ) {
      return { dim, proposals: [] as Array<{ name: string; keywords: string[] }> }
    }
    const unclassifiedProjects = projects.filter((p) => {
      const text = `${p.title || ''} ${p.abstract || ''}`.toLowerCase()
      return !dim.categories.some((c) => c.keywords.some((kw) => matchesKeyword(text, kw)))
    })
    if (unclassifiedProjects.length === 0) {
      return { dim, proposals: [] as Array<{ name: string; keywords: string[] }> }
    }
    const proposals = await proposeAdditionalCategories(
      topic,
      dim,
      unclassifiedProjects,
      client,
      usageTracker,
    )
    return { dim, proposals }
  })

  const secondPassResults = await Promise.all(secondPassPromises)

  const refined: CoverageDimension[] = []
  for (const { dim, proposals } of secondPassResults) {
    if (proposals.length === 0) {
      refined.push(dim)
      continue
    }

    // Compute coverage for each new category against ALL projects (not
    // just unclassified) — the LLM's proposed category might match some
    // already-classified projects too, and that's fine (a project can
    // belong to multiple categories).
    const merged: CoverageDimension = {
      ...dim,
      categories: [...dim.categories],
    }
    for (const newCat of proposals) {
      if (merged.categories.length >= MAX_CATEGORIES_PER_DIMENSION) break
      const matched = projects.filter((p) => {
        const text = `${p.title || ''} ${p.abstract || ''}`.toLowerCase()
        return newCat.keywords.some((kw) => matchesKeyword(text, kw))
      })
      if (matched.length === 0) continue // drop categories with no actual hits
      merged.categories.push({
        name: newCat.name,
        keywords: newCat.keywords,
        projectCount: matched.length,
        fundingTotal: matched.reduce((s, p) => s + (p.total_cost || 0), 0),
        broaderNihCount: 0, // filled in step 3
        projectExamples: matched
          .slice(0, 3)
          .map((p) => p.project_number || p.application_id)
          .filter((v): v is string => !!v),
      })
    }

    // Recompute dimension totals from the expanded category set.
    const searchables = projects.map((p) => ({
      project: p,
      text: `${p.title || ''} ${p.abstract || ''}`.toLowerCase(),
    }))
    const anyMatched = searchables.filter((s) =>
      merged.categories.some((cat) => cat.keywords.some((kw) => matchesKeyword(s.text, kw))),
    ).length
    merged.totalMatched = anyMatched
    merged.totalUnclassified = projects.length - anyMatched

    console.log(
      `[White Space] Second-pass for "${dim.name}": added ${merged.categories.length - dim.categories.length} categories, unclassified ${dim.totalUnclassified} → ${merged.totalUnclassified}`,
    )
    refined.push(merged)
  }

  return refined
}

async function proposeAdditionalCategories(
  topic: string,
  dim: CoverageDimension,
  unclassifiedProjects: ProjectItem[],
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<Array<{ name: string; keywords: string[] }>> {
  const titleSample = unclassifiedProjects
    .slice(0, 40)
    .map((p) => `- ${p.title || '(untitled)'}`)
    .join('\n')
  const existing = dim.categories.map((c) => c.name).join(', ')
  const slotsLeft = MAX_CATEGORIES_PER_DIMENSION - dim.categories.length

  const prompt = `We are auditing NIH-funded projects on "${topic}" along the coverage dimension:

  Dimension: ${dim.name} — ${dim.description}
  Existing categories in this dimension: ${existing}

The following ${unclassifiedProjects.length} projects did NOT match any existing category. Propose ADDITIONAL categories (max ${slotsLeft}) along the SAME dimension that would classify these unclassified projects.

## Unclassified project titles (up to 40 shown)
${titleSample}

## RULES
- New categories must be along the SAME dimension "${dim.name}".
- Do NOT duplicate any existing category (${existing}).
- Some projects may genuinely be platform/methods work with no specific ${dim.name} — that's OK; don't force categories on them.
- Each new category needs 4-8 keyword variants (synonyms, common abbreviations, disease subtypes).
- Every keyword MUST be at least ${MIN_KEYWORD_LENGTH} characters. Never propose "ev", "ai", or similar 2-char tokens — they match unrelated words and inflate counts.
- **NO SUPERSET-SOUNDING NAMES.** Do not use "general", "other", "misc", "generic", or "multi-X" as the primary descriptor in the category name. If the projects share a meta-framing (cross-fluid, multi-modality), name it directly: "Multi-Fluid Panel Studies" not "Non-plasma Biofluids (general)". If a leftover bucket has no coherent specific name, return no category for it.
- If the unclassified projects are genuinely dimension-agnostic (e.g., cfDNA biogenesis work for a Cancer Type dimension), return an empty categories array.

Return JSON only:
{
  "categories": [
    { "name": "Head and Neck", "keywords": ["head and neck cancer", "oropharyngeal", "hpv-associated", "hnsc"] }
  ]
}`

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
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
    if (!parsed || !Array.isArray(parsed.categories)) return []

    return parsed.categories
      .map((c: unknown) => {
        const cat = c as { name?: string; keywords?: unknown }
        return {
          name: (cat.name || '').trim(),
          keywords: Array.isArray(cat.keywords)
            ? cat.keywords
                .map((k: unknown) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
                .filter((k: string) => k.length >= MIN_KEYWORD_LENGTH)
            : [],
        }
      })
      .filter((c: { name: string; keywords: string[] }) => c.name && c.keywords.length > 0)
  } catch (err) {
    console.error('[White Space] Second-pass proposal failed:', err)
    return []
  }
}

/**
 * Step 3 — for each category, count matching projects across the FULL
 * projects table (not just the topic slice). Uses PostgREST OR filter
 * with word-boundary regex patterns on `title`. `\m` / `\M` are the
 * Postgres word-boundary markers (\m = start of word, \M = end).
 * Without those, a 3-char keyword like "hcc" matches inside "hccp",
 * "phccc" etc, and short tokens balloon into tens of thousands of
 * false hits.
 *
 * Titles only (not abstracts). abstract_text isn't trigram-indexed on
 * this database, so an ilike/regex against it silently statement-times-
 * out. Instead we lean on the LLM to produce comprehensive keyword
 * synonym sets — "cell-free DNA", "cfdna", "circulating cell-free DNA"
 * are all listed so we catch titles regardless of how the PI phrased it.
 *
 * This makes broader-NIH counts a CONSERVATIVE FLOOR (some abstracts
 * mention a concept the title omits). That's why the scope note frames
 * them as a floor rather than exact counts.
 */
async function addBroaderNihCounts(
  dimensions: CoverageDimension[],
  scope: TopicScope,
): Promise<CoverageDimension[]> {
  // Build the topic-scope OR filter once. The broader-NIH count for
  // each category will be constrained to projects whose title ALSO
  // matches at least one scope keyword. This fixes the audit finding
  // that "1,768 broader machine-learning projects" was raw keyword
  // prevalence across all of NIH — meaningless when comparing to a
  // narrow topical slice. Now the comparator is topically-filtered.
  //
  // If no scope keywords were produced (edge case), fall back to
  // unfiltered search and mark counts as unscoped so the render
  // can label them differently.
  const scopePatterns: string[] = []
  for (const kwRaw of scope.scopeKeywords) {
    const kw = kwRaw.replace(/,/g, ' ').trim()
    if (kw.length < MIN_KEYWORD_LENGTH) continue
    const escaped = escapeForPgRegex(kw)
    const hasSeparator = /[\s\-/]/.test(kw)
    const regex = hasSeparator ? escaped : `\\m${escaped}\\M`
    scopePatterns.push(`title.imatch.${regex}`)
  }
  const scopeIsActive = scopePatterns.length > 0

  const workItems: Array<{ cat: CoverageCategory; patterns: string[] }> = []
  const overflow: CoverageCategory[] = []
  for (const dim of dimensions) {
    for (const cat of dim.categories) {
      if (workItems.length >= MAX_BROADER_QUERIES) {
        overflow.push(cat)
        continue
      }
      const patterns: string[] = []
      for (const kwRaw of cat.keywords) {
        const kw = kwRaw.replace(/,/g, ' ').trim()
        if (kw.length < MIN_KEYWORD_LENGTH) continue
        const escaped = escapeForPgRegex(kw)
        const hasSeparator = /[\s\-/]/.test(kw)
        const regex = hasSeparator ? escaped : `\\m${escaped}\\M`
        patterns.push(`title.imatch.${regex}`)
      }
      if (patterns.length === 0) {
        cat.broaderNihCount = 0
        continue
      }
      workItems.push({ cat, patterns })
    }
  }
  for (const cat of overflow) cat.broaderNihCount = -1

  // Fire all count queries in parallel. Each query ANDs the category's
  // keyword OR-filter with the topic-scope OR-filter — PostgREST chains
  // multiple .or() calls with AND semantics.
  await Promise.all(
    workItems.map(async ({ cat, patterns }) => {
      try {
        let query = supabaseAdmin
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .or(patterns.join(','))
        if (scopeIsActive) {
          query = query.or(scopePatterns.join(','))
        }
        const { count, error } = await query
        if (error) {
          console.warn(
            `[White Space] Broader count error for ${cat.name}:`,
            JSON.stringify(error),
          )
          cat.broaderNihCount = 0
        } else {
          cat.broaderNihCount = count ?? 0
        }
      } catch (err) {
        console.warn(`[White Space] Broader count exception for ${cat.name}:`, err)
        cat.broaderNihCount = 0
      }
    }),
  )

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

      // Small-N floor: require meaningful broader-NIH activity before
      // calling a category a coverage-gap signal. Without this, a
      // "0 sample vs 5 broader" case surfaces as a gap when the true
      // signal is noise — 5 is too few to distinguish an underexplored
      // intersection from a keyword-match artifact. Raised from 20
      // (2026-07-10) after reviewer flagged low-N gaps looking dubious.
      const BROADER_FLOOR_ABSENT = 30
      const BROADER_FLOOR_SPARSE = 30

      // Hard floor: NO gap signal ranked when broader-NIH < 30. Applies
      // to every signal type including sparse-in-topic. r30 audit
      // flagged two ranked signals sitting below the floor (6 and 23)
      // that were caveated but still numbered — a caveated gap-signal
      // reads as a gap to the skim reader. Hard-block instead.
      if (broaderCount < 30 && broaderCount !== -1) continue

      if (cat.projectCount === 0 && broaderCount >= BROADER_FLOOR_ABSENT) {
        // Not in the topic slice at all, but present in broader NIH portfolio
        signal = 'absent-in-topic'
      } else if (
        sampleShare < SPARSE_SHARE_THRESHOLD &&
        broaderCount >= BROADER_FLOOR_SPARSE &&
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
  persona: 'researcher' | 'investor',
): Promise<{
  overview: string
  dimensions: CoverageDimension[]
  opportunities: WhiteSpaceOpportunity[]
  strategicImplications?: string
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
- MUST END WITH a Confidence+Evidence tag: '**Confidence: High/Medium/Low** - Evidence: [total projects, dimension count, any notable data-quality caveats]'.

For each DIMENSION's narrative field: 2-3 sentences interpreting THAT dimension's distribution. Call out concentration (top category share), meaningful clusters, and any striking absences. Reference actual category counts from the data. MUST END WITH a Confidence+Evidence tag ('**Confidence: High/Medium/Low** - Evidence: [category counts, top concentration ratio]').

**CRITICAL — Do NOT draw underrepresentation or "gap" conclusions from broader-NIH counts below 30.** A category with (sample=0, broaderNIH=7) is too sparse to distinguish a real gap from vocabulary drift or keyword-matching noise. If you MUST mention such a category in the dimension narrative, describe the raw counts only ("population disparities appears in 0 projects with 7 broader NIH matches, too sparse to draw a coverage conclusion") — do NOT write "underrepresented", "gap", or "opportunity" for those rows. The Coverage Gap Signals list is where opportunity-language belongs, and it applies its own >=30 floor.

**KEYWORD-ARTIFACT WATCH.** If any single category in a dimension has a broader-NIH count that is more than 10x the median broader-NIH count of other categories in the SAME dimension, flag it in your narrative as a likely keyword-matching artifact (e.g., generic terms like "methylation" or "exosome" match across all of cancer biology). Write something like "the broader NIH count of X for this category is anomalous relative to peer categories in this dimension and likely reflects generic keyword prevalence rather than topic-specific activity — treat as directional only." Do NOT anchor coverage conclusions on these outlier counts.

For each OPPORTUNITY's rationale field: 2-3 sentences answering "why might this white space matter." Consider:
- If sample count is zero or near-zero but broader NIH count is substantial: the topic slice has a gap that the broader research community is exploring — potential opportunity to bring adjacent methodology.
- If sample count is nonzero but small: underserved within the topic focus specifically.
- Reference actual counts. Do not overstate — say "underrepresented" not "abandoned."
- MUST END WITH a Confidence+Evidence tag ('**Confidence: High/Medium/Low** - Evidence: [sample count vs broader count, ratio]'). At low sample counts (<=2), confidence must be Low.

FORMATTING: Do NOT use em dashes (—). Use regular hyphens or rewrite sentences.
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation"). Say what the thing IS, not that it is "genuine".

DESCRIPTIVE vs PRESCRIPTIVE — critical rule for narrative + strategicImplications fields:
- Naming institutions is FINE when describing factual concentration ("methylation work concentrates at UCLA, Johns Hopkins, Stanford").
- Naming institutions is NOT FINE when prescribing action toward them ("engage with UCLA researchers", "the Johns Hopkins cluster is an obvious collaboration target"). Rewrite as pattern-level observations.
- Do NOT name individual PIs by name in any narrative or rationale field. PI-level detail belongs in the Key Researchers table, not the narrative.

STRATEGIC IMPLICATIONS (REQUIRED):
Produce a persona-appropriate strategicImplications paragraph tied to the top opportunities. Reader persona is: **${persona}**.

- Researcher persona: frame around grant strategy. "For a researcher writing an R01 or SBIR in this space, the strongest differentiation opportunities are..." Reference specific opportunity names and counts. Mention concrete grant mechanisms where relevant (R01, R21, U01, SBIR/STTR). Speak to patterns and mechanisms, not "approach X institution."
- Investor persona: frame around investment thesis. "For a seed-stage or Series A investor evaluating this space, the highest-signal bets among under-served categories are..." Reference specific opportunity names and counts. Mention what technical or clinical milestones would validate a bet. Do not name specific companies or PIs as targets.

3-4 sentences. Concrete and actionable, not hand-wavy. MUST END WITH a Confidence+Evidence tag ('**Confidence: High/Medium/Low** - Evidence: [top opportunity counts + ratios that anchor the implications]'). At low sample counts across the top opportunities, confidence should be Medium or Low.

Return JSON only, exactly this shape:
{
  "overview": "...",
  "dimensionNarratives": [
    { "name": "Cancer Type", "narrative": "..." },
    { "name": "Biofluid", "narrative": "..." }
  ],
  "opportunityRationales": [
    { "categoryName": "Pancreatic", "dimensionName": "Cancer Type", "rationale": "..." }
  ],
  "strategicImplications": "3-4 sentences of persona-specific 'so what' advice tied to the top opportunities"
}`

  try {
    const response = await client.messages.create({
      model: MODEL,
      // 3800 for overview + 5 dimension narratives + up to 5 opportunity
      // rationales + strategicImplications. 3500 was landing tight on
      // longer topics; 3800 restores headroom against truncation.
      max_tokens: 3800,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 120_000,
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
    // change the numbers; it only fills in narrative fields. Every
    // narrative field runs through normalizeConfidenceTagSpacing so the
    // inline "**Confidence:**" tags land on their own paragraph — Fable
    // r28 audit flagged pervasive inline tags across White Space fields.
    const dimNarrativeMap = new Map<string, string>()
    if (Array.isArray(parsed.dimensionNarratives)) {
      for (const dn of parsed.dimensionNarratives) {
        if (dn?.name && typeof dn.narrative === 'string') {
          dimNarrativeMap.set(dn.name.toLowerCase(), normalizeConfidenceTagSpacing(dn.narrative))
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
          rationaleMap.set(key, normalizeConfidenceTagSpacing(or.rationale))
        }
      }
    }
    const opportunitiesOut = opportunities.map((op) => ({
      ...op,
      rationale:
        rationaleMap.get(`${op.dimensionName.toLowerCase()}|${op.categoryName.toLowerCase()}`) || '',
    }))

    return {
      overview:
        typeof parsed.overview === 'string' ? normalizeConfidenceTagSpacing(parsed.overview) : '',
      dimensions: dimensionsOut,
      opportunities: opportunitiesOut,
      strategicImplications:
        typeof parsed.strategicImplications === 'string'
          ? normalizeConfidenceTagSpacing(parsed.strategicImplications)
          : undefined,
    }
  } catch (err) {
    console.error('[White Space] Narrate step failed:', err)
    return { overview: '', dimensions, opportunities }
  }
}

function buildScopeNote(scopeLabel?: string): string {
  const broaderComparator = scopeLabel
    ? `Broader-NIH counts are constrained to ${scopeLabel} (title-match against a 10-16 term scope filter) so the comparison is topically apples-to-apples, not raw keyword prevalence across all of NIH. `
    : 'Broader-NIH counts are keyword title-match across NIH RePORTER without additional topical constraint. '
  return (
    'This analysis maps what NIH-funded research covers vs. gaps within the topic scope. ' +
    'NIH RePORTER represents the largest publicly-searchable portion of non-dilutive US biomedical grants — a strong signal for federal research investment priorities. ' +
    'Private R&D, international research, and non-NIH federal funding (DoD, DARPA, industry-sponsored) are not captured here. ' +
    broaderComparator +
    'Two match methods are used and they intentionally differ. **Sample counts** (the analyzed topic-focused projects) are computed against project titles AND abstracts — full-text matching gives higher recall on the ~100-200 project sample. **Broader-NIH counts** are computed against project titles ONLY, because the broader RePORTER projects table is not full-text-indexed on abstracts at query time. Because broader-NIH matching is title-only, broader counts should be read as **directional lower bounds** — an NIH-funded cancer project titled "Circulating Cell-Free DNA in Glioblastoma" won\'t match a "cancer" scope keyword but is clearly cancer-relevant, so the true broader activity is higher than what we count. A project can appear in multiple categories. ' +
    'Broader-NIH ratios at low denominators (≤2 topic projects) are directional not precise — small changes to the topic classifier could shift them meaningfully.'
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
    strategicImplications: undefined,
  }
}
