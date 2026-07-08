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

  // Step 1: topic-adaptive dimensions
  const schema = await inferCoverageDimensions(topic, projects, client, usageTracker)
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
  // against the full projects table)
  const dimensionsWithBroader = await addBroaderNihCounts(dimensionsRefined)

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
    scopeNote: buildScopeNote(),
    dimensions: withNarrative.dimensions,
    topOpportunities: withNarrative.opportunities,
    totalProjects,
    totalFunding,
    strategicImplications: withNarrative.strategicImplications,
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

## KEYWORD RULES (critical for accurate counting)

- Provide 5-10 keyword variants per category. INCLUDE synonyms, common abbreviations, disease subtypes, and adjective/noun variants.
- MINIMUM keyword length: ${MIN_KEYWORD_LENGTH} characters. Never give a 2-character keyword like "ev" or "ai" — they match unrelated words ("level", "development", "brain") and inflate counts by 5x or more. Even for genuine 2-letter acronyms, use the expanded form or a 3+ char variant ("evs", "ev-based", "extracellular vesicle").
- Keywords are matched with WORD BOUNDARIES for single tokens, so include the FULL specific term. "cfdna" as a keyword will match "cfdna" or "cfDNA" but not "cell-free DNA" — include both variants explicitly.
- For hyphenated or multi-word keywords, they match as substrings — that's fine since they're already specific.
- AVOID overly-common words. "cancer" alone in a cancer-detection topic matches everything and reveals nothing.
- DO NOT rely on partial matches. If a category needs to catch "hepatocellular carcinoma" write out "hepatocellular", "hcc", "liver cancer", "hepatoma" as separate keywords — don't rely on "hep" matching all of them.

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
      // 5 dimensions × 12 categories × 5-10 keywords ~= 4-6k tokens of
      // JSON payload. Give plenty of headroom or the JSON gets truncated
      // mid-array and JSON.parse throws.
      max_tokens: 8000,
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
    return dimensions
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
  const refined: CoverageDimension[] = []

  for (const dim of dimensions) {
    const total = dim.totalMatched + dim.totalUnclassified
    const unclassifiedRate = total > 0 ? dim.totalUnclassified / total : 0
    if (unclassifiedRate < SECOND_PASS_UNCLASSIFIED_THRESHOLD || dim.categories.length >= MAX_CATEGORIES_PER_DIMENSION) {
      refined.push(dim)
      continue
    }

    // Find the actual unclassified projects using the same matcher.
    const unclassifiedProjects = projects.filter((p) => {
      const text = `${p.title || ''} ${p.abstract || ''}`.toLowerCase()
      return !dim.categories.some((c) => c.keywords.some((kw) => matchesKeyword(text, kw)))
    })
    if (unclassifiedProjects.length === 0) {
      refined.push(dim)
      continue
    }

    const newCategoryProposals = await proposeAdditionalCategories(
      topic,
      dim,
      unclassifiedProjects,
      client,
      usageTracker,
    )
    if (newCategoryProposals.length === 0) {
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
    for (const newCat of newCategoryProposals) {
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
async function addBroaderNihCounts(dimensions: CoverageDimension[]): Promise<CoverageDimension[]> {
  let queryCount = 0

  for (const dim of dimensions) {
    for (const cat of dim.categories) {
      if (queryCount >= MAX_BROADER_QUERIES) {
        cat.broaderNihCount = -1 // sentinel for "not queried"
        continue
      }
      const patterns: string[] = []
      for (const kwRaw of cat.keywords) {
        const kw = kwRaw.replace(/,/g, ' ').trim()
        if (kw.length < MIN_KEYWORD_LENGTH) continue
        const escaped = escapeForPgRegex(kw)
        // PostgREST .or() operator alias for ~* is `imatch`. Wrap
        // single-token keywords in \m...\M for word-boundary matching.
        // Multi-word phrases already contain spaces that act as
        // boundaries, so plain (regex-escaped) form is enough.
        const hasSeparator = /[\s\-/]/.test(kw)
        const regex = hasSeparator ? escaped : `\\m${escaped}\\M`
        patterns.push(`title.imatch.${regex}`)
      }
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
          console.warn(
            `[White Space] Broader count error for ${cat.name}:`,
            JSON.stringify(error),
          )
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

For each DIMENSION's narrative field: 2-3 sentences interpreting THAT dimension's distribution. Call out concentration (top category share), meaningful clusters, and any striking absences. Reference actual category counts from the data.

For each OPPORTUNITY's rationale field: 2-3 sentences answering "why might this white space matter." Consider:
- If sample count is zero or near-zero but broader NIH count is substantial: the topic slice has a gap that the broader research community is exploring — potential opportunity to bring adjacent methodology.
- If sample count is nonzero but small: underserved within the topic focus specifically.
- Reference actual counts. Do not overstate — say "underrepresented" not "abandoned."

FORMATTING: Do NOT use em dashes (—). Use regular hyphens or rewrite sentences.

STRATEGIC IMPLICATIONS (REQUIRED):
Produce a persona-appropriate strategicImplications paragraph tied to the top opportunities. Reader persona is: **${persona}**.

- Researcher persona: frame around grant strategy. "For a researcher writing an R01 or SBIR in this space, the strongest differentiation opportunities are..." Reference specific opportunity names and counts. Mention concrete grant mechanisms where relevant (R01, R21, U01, SBIR/STTR).
- Investor persona: frame around investment thesis. "For a seed-stage or Series A investor evaluating this space, the highest-signal bets among under-served categories are..." Reference specific opportunity names and counts. Mention what technical or clinical milestones would validate a bet.

3-4 sentences. Concrete and actionable, not hand-wavy.

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
      // Bumped from 3000 to accommodate the new strategicImplications
      // field on top of the existing overview + dimension narratives +
      // opportunity rationales.
      max_tokens: 4000,
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
      strategicImplications:
        typeof parsed.strategicImplications === 'string' ? parsed.strategicImplications : undefined,
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
    strategicImplications: undefined,
  }
}
