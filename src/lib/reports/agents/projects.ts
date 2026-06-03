// Projects Agent
// Searches NIH projects using pure semantic search (aligned with UI)
// Returns up to 100 projects sorted by relevance

import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import type { ProjectsAgentOutput, ProjectItem } from '../types'
import { isPartialFiscalYear } from '../fiscal-year'
import {
  SEMANTIC_FLOOR,
  THRESHOLD_BALANCED as SHARED_BALANCED,
  THRESHOLD_PRECISE as SHARED_PRECISE,
} from '../thresholds'

const anthropic = new Anthropic()

// Match tier thresholds — single source of truth in ../thresholds.ts so the
// audit doc and other agents reference the same numeric values.
const THRESHOLD_BALANCED = SHARED_BALANCED
const THRESHOLD_PRECISE = SHARED_PRECISE
const SEMANTIC_THRESHOLD = SEMANTIC_FLOOR
const MAX_PROJECTS = 200  // Fetch more, filter to balanced subset

/**
 * Extract core project number for deduplication
 * Strips support type prefix and budget period suffix
 * Example: "5R44MH136894-02" → "R44MH136894"
 * (Aligned with UI - tools.ts:11)
 */
function getCoreProjectNumber(projectNumber: string | null): string {
  if (!projectNumber) return ''
  let core = projectNumber.trim().toUpperCase()
  // Remove leading digit (support type indicator)
  core = core.replace(/^[0-9]/, '')
  // Remove suffix after hyphen (-01, -02, etc.) - budget period indicator
  core = core.replace(/-\d+$/, '')
  // Also handle alternative suffix formats like -S1, -A1
  core = core.replace(/-[A-Z]\d+$/, '')
  return core
}

/**
 * Generate a deduplication key for a project
 * Uses core project number when available, otherwise falls back to title + org_name
 */
function getProjectDedupeKey(project: { project_number?: string; title: string; org_name?: string }): string {
  const coreKey = getCoreProjectNumber(project.project_number || null)
  if (coreKey) return coreKey
  // Fallback: use normalized title + org_name
  const titleKey = (project.title || '').toLowerCase().trim()
  const orgKey = (project.org_name || '').toLowerCase().trim()
  return `${titleKey}|${orgKey}`
}

/**
 * Generate a secondary deduplication key based on normalized title + PI name
 * This catches cases where the same PI has multiple grants with similar titles
 */
function getTitlePiDedupeKey(project: { title: string; pi_names?: string }): string {
  // Normalize title: lowercase, remove punctuation, collapse whitespace
  const normalizedTitle = (project.title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Extract first PI name (before semicolon)
  const firstPi = (project.pi_names || '')
    .split(';')[0]
    .toLowerCase()
    .trim()
  return `${normalizedTitle}|${firstPi}`
}

// System prompt matching the UI chat (from prompts.ts)
// This ensures reports generate the exact same semantic queries as UI searches
const QUERY_SYSTEM_PROMPT = `=== HOW SEARCH WORKS ===
search_projects takes TWO separate queries:
1. keyword_query: For text matching. Use pipes for synonyms: "neural|brain|cerebral organoid|organoids"
2. semantic_query: Natural language for embedding search: "neural organoid platforms for studying brain diseases"

=== QUERY OPTIMIZATION ===
keyword_query: ONLY core scientific terms. Add synonyms with pipes.
- SKIP these generic words: platform, approach, development, research, tools, method, technique, system, application
- These words go in semantic_query only

semantic_query: Full natural language with ALL words including generic ones.

Examples:
- User: "neural organoid platform"
  keyword_query: "neural|brain|cerebral organoid|organoids"
  semantic_query: "neural organoid platforms for brain research and disease modeling"

- User: "CRISPR gene therapy"
  keyword_query: "CRISPR|Cas9 gene therapy|gene editing"
  semantic_query: "CRISPR-based gene therapy approaches for treating genetic diseases"

- User: "mass spec for proteomics"
  keyword_query: "mass spectrometry|mass spec|MS proteomics|proteomic"
  semantic_query: "mass spectrometry techniques for proteomics analysis"

- User: "CAR-T solid tumors"
  keyword_query: "CAR-T|CAR T cell solid tumor|tumors"
  semantic_query: "CAR-T cell therapy development for solid tumor cancers"`

/**
 * Transform a topic into a semantic query using Claude
 * Uses the exact same system prompt as the UI chat to ensure identical results
 */
async function buildSemanticQuery(topic: string): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0, // Deterministic output
      system: QUERY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Search for: ${topic}\n\nRespond with JSON only: {"keyword_query": "...", "semantic_query": "..."}`
      }]
    })

    const text = response.content[0]
    if (text.type === 'text') {
      // Strip markdown code fences if present, then regex-extract the JSON
      // object. Matches the defensive pattern used by JSON parsers in
      // synthesize.ts. Legacy path only — runs when no injectedInterpretation
      // is supplied, which is rare in production now that the picker is
      // wired through every report flow.
      let jsonText = text.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
      }
      const objectMatch = jsonText.match(/\{[\s\S]*\}/)
      if (objectMatch) {
        try {
          const parsed = JSON.parse(objectMatch[0])
          if (parsed.semantic_query) return parsed.semantic_query
        } catch {
          // fall through to regex extraction below
        }
      }
      // Last-resort field extraction if structured parse fails
      const match = text.text.match(/"semantic_query":\s*"([^"]+)"/)
      if (match) return match[1]
    }
  } catch (error) {
    console.error('[Projects Agent] Claude query transformation failed:', error)
  }

  // Fallback: add simple context
  return `${topic} research and development`
}

/**
 * Run the Projects Agent to gather project data for a topic
 * Uses pure semantic search aligned with UI for consistency
 * Returns up to 100 projects sorted by similarity (most relevant first)
 *
 * @param injectedInterpretation - Optional human-chosen interpretation from
 *   the picker UI. When provided, skips the internal Claude-rewrite step
 *   (which is non-deterministic at temp=0 and was causing identical topics
 *   to produce non-reproducible result sets across report runs).
 */
export async function runProjectsAgent(
  topic: string,
  injectedInterpretation?: { semanticQuery: string; keywordQuery: string; label: string }
): Promise<ProjectsAgentOutput> {
  console.log(`[Projects Agent] Searching for "${topic}"`)

  // Use injected interpretation if available; otherwise generate via Claude
  // (legacy path, retained for backward compatibility and other call sites).
  const semanticQuery = injectedInterpretation
    ? injectedInterpretation.semanticQuery
    : await buildSemanticQuery(topic)
  if (injectedInterpretation) {
    console.log(`[Projects Agent] Using injected interpretation '${injectedInterpretation.label}': "${semanticQuery}"`)
  } else {
    console.log(`[Projects Agent] Semantic query (auto-generated): "${semanticQuery}"`)
  }

  // Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(semanticQuery)

  // Pure semantic search - aligned with UI approach
  const { data: semanticResults, error } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: queryEmbedding,
    match_threshold: SEMANTIC_THRESHOLD,
    match_count: MAX_PROJECTS,
    min_biotools_confidence: 0,
    filter_fiscal_years: null,
    filter_categories: null,
    filter_org_types: null,
    filter_states: null,
    filter_min_funding: null,
    filter_max_funding: null,
  })

  if (error) {
    console.error('[Projects Agent] Search error:', error)
    return emptyOutput()
  }

  if (!semanticResults || semanticResults.length === 0) {
    console.log('[Projects Agent] No results found')
    return emptyOutput()
  }

  // Results come back sorted by similarity (highest first)
  const rawResults = semanticResults as Array<RawProjectResult & { similarity?: number }>

  // PASS 1: Deduplicate by core project number (aligned with UI deduplication)
  // This strips budget period suffixes so "5R44MH136894-02" and "1R44MH136894-01" are treated as same project
  const seenProjects = new Map<string, RawProjectResult & { similarity?: number }>()
  for (const project of rawResults) {
    const key = getProjectDedupeKey(project)
    const existing = seenProjects.get(key)
    if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
      seenProjects.set(key, project)
    }
  }

  // PASS 2: Deduplicate by title + PI name
  // This catches cases where the same PI has multiple grants (different project numbers) with identical titles
  // Keep the higher-funded one (larger grants are typically primary), or most recent if funding is equal
  const pass1Results = Array.from(seenProjects.values())
  const seenTitlePi = new Map<string, RawProjectResult & { similarity?: number }>()
  for (const project of pass1Results) {
    const key = getTitlePiDedupeKey(project)
    const existing = seenTitlePi.get(key)
    if (!existing) {
      seenTitlePi.set(key, project)
    } else {
      // Keep the higher-funded project (typically the primary grant vs. supplemental)
      // If funding is equal, keep the most recent fiscal year
      const existingFunding = existing.total_cost || 0
      const projectFunding = project.total_cost || 0
      if (projectFunding > existingFunding ||
          (projectFunding === existingFunding && (project.fiscal_year || 0) > (existing.fiscal_year || 0))) {
        seenTitlePi.set(key, project)
      }
    }
  }

  const deduplicatedResults = Array.from(seenTitlePi.values())
  const pass2Removed = pass1Results.length - deduplicatedResults.length
  if (pass2Removed > 0) {
    console.log(`[Projects Agent] Title+PI deduplication removed ${pass2Removed} additional duplicates`)
  }

  // Use fully deduplicated results (both passes applied)
  const uniqueResults = deduplicatedResults
    // Re-sort by similarity after deduplication
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))

  // Filter to balanced threshold - this defines the report population
  // Semantic search already ensures topical relevance through embedding similarity,
  // so we don't apply additional keyword or AI relevance filters to projects.
  // The balanced threshold (0.35) provides sufficient precision while maintaining
  // recall for specialized topics with varied terminology.
  const relevantProjects = uniqueResults.filter(p => (p.similarity || 0) >= THRESHOLD_BALANCED)

  console.log(`[Projects Agent] Balanced threshold filter: ${relevantProjects.length}/${uniqueResults.length} projects`)

  if (relevantProjects.length === 0) {
    console.log('[Projects Agent] No projects above balanced threshold')
    return emptyOutput()
  }

  // Get core project numbers from the RELEVANT subset only
  const relevantCoreNumbers = new Set<string>()
  for (const project of relevantProjects) {
    const core = getCoreProjectNumber(project.project_number || null)
    if (core) relevantCoreNumbers.add(core)
  }

  // Now collect ALL project_number variants from raw results, but ONLY for projects
  // whose core number is in the relevant subset. This ensures we find linked data
  // under any variant (e.g., "5R44MH136894-02" or "1R44MH136894-01") but ONLY for
  // projects that passed both similarity AND relevance thresholds.
  const allProjectNumbers = rawResults
    .map(p => p.project_number)
    .filter((pn): pn is string => {
      if (!pn || pn.trim() === '') return false
      const core = getCoreProjectNumber(pn)
      return relevantCoreNumbers.has(core)
    })

  console.log(
    `[Projects Agent] Collected ${allProjectNumbers.length} project_number variants ` +
    `for ${relevantCoreNumbers.size} relevant projects`
  )

  // Log similarity distribution
  const similarities = uniqueResults.map(p => p.similarity || 0)
  const minSim = Math.min(...similarities)
  const maxSim = Math.max(...similarities)
  const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length

  console.log(
    `[Projects Agent] Found ${uniqueResults.length} unique projects ` +
      `(similarity: ${minSim.toFixed(3)} - ${maxSim.toFixed(3)}, avg: ${avgSim.toFixed(3)})`
  )

  // Filter raw rows down to ALL budget periods of relevant projects.
  // These power the year-by-year aggregation and per-project total funding
  // (sum across all budget periods), while the deduped `relevantProjects`
  // list is what we display as the "key projects" entries.
  const relevantRawRows = rawResults.filter((r) => {
    const core = getCoreProjectNumber(r.project_number || null)
    return !!core && relevantCoreNumbers.has(core)
  })

  return processResults(relevantProjects, relevantRawRows, allProjectNumbers)
}

/**
 * Determine match tier based on similarity score
 */
function getMatchTier(similarity: number): 'precise' | 'balanced' | 'broad' {
  if (similarity >= THRESHOLD_PRECISE) return 'precise'
  if (similarity >= THRESHOLD_BALANCED) return 'balanced'
  return 'broad'
}

/**
 * Process relevant search results into agent output.
 *
 * Aggregation rules (post-2026-05 refactor — keep counts deduped, dollars raw):
 *  - Project counts (projectCount, byCategory.projects, byOrg.projects, etc.):
 *    one entry per project, sourced from the deduped `relevantResults`.
 *  - Funding totals (totalFunding, byCategory.funding, byOrg.funding,
 *    per-project total_cost on ProjectItem): sum of total_cost across ALL
 *    matching budget periods for each project, sourced from `relevantRawRows`.
 *  - byYear: sum of total_cost per fiscal_year from `relevantRawRows`. A
 *    project running 2024-2026 contributes its actual 2024, 2025, and 2026
 *    awards to the correct years instead of disappearing into the latest
 *    period only. isPartial flags the current NIH fiscal year (Oct 1 - Sep 30
 *    hasn't ended yet at report-generation time).
 *
 * @param relevantResults - Deduplicated set, one row per project
 * @param relevantRawRows - All budget-period rows belonging to relevant projects
 * @param allProjectNumbers - Project_number variants (for linked-data lookup)
 */
function processResults(
  relevantResults: Array<RawProjectResult & { similarity?: number }>,
  relevantRawRows: Array<RawProjectResult & { similarity?: number }>,
  allProjectNumbers: string[]
): ProjectsAgentOutput {
  const preciseCount = relevantResults.filter(p => (p.similarity || 0) >= THRESHOLD_PRECISE).length

  console.log(
    `[Projects Agent] Processing ${relevantResults.length} relevant matches ` +
    `(${preciseCount} precise, ${relevantResults.length - preciseCount} balanced); ` +
    `${relevantRawRows.length} raw budget-period rows`
  )

  // Per-project total funding — sum total_cost across all budget periods.
  // Keyed by core project number so all variants roll up into one entry.
  const perProjectTotal = new Map<string, number>()
  for (const r of relevantRawRows) {
    const core = getCoreProjectNumber(r.project_number || null)
    if (!core) continue
    perProjectTotal.set(core, (perProjectTotal.get(core) || 0) + (r.total_cost || 0))
  }

  // Map to ProjectItem format. total_cost on each item is now the project's
  // committed funding across all budget periods (not just the latest period).
  // fiscal_year stays as the latest budget period's year — useful as a
  // "most recent activity" indicator on the project card.
  const items: ProjectItem[] = relevantResults.map((p) => {
    const core = getCoreProjectNumber(p.project_number || null)
    const projectTotal = (core && perProjectTotal.get(core)) || (p.total_cost || 0)
    return {
      application_id: p.application_id,
      project_number: p.project_number || null,
      title: p.title,
      abstract: p.phr || null, // PHR is the abstract equivalent in NIH data
      pi_names: p.pi_names || null,
      org_name: p.org_name || null,
      total_cost: projectTotal,
      fiscal_year: p.fiscal_year || null,
      primary_category: p.primary_category || null,
      similarity: p.similarity || null,
      match_tier: p.similarity ? getMatchTier(p.similarity) : null,
    }
  })

  // Total funding: sum of per-project totals across the deduped set.
  const totalFunding = items.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  // byYear: actual spend per fiscal_year from raw budget-period rows.
  // Count unique projects (via core number) so a multi-year project counts
  // once per year it had funding, not multiple times per year.
  const yearFunding = new Map<number, number>()
  const yearCoreSet = new Map<number, Set<string>>()
  for (const r of relevantRawRows) {
    if (!r.fiscal_year) continue
    const core = getCoreProjectNumber(r.project_number || null)
    if (!core) continue
    yearFunding.set(r.fiscal_year, (yearFunding.get(r.fiscal_year) || 0) + (r.total_cost || 0))
    let coresInYear = yearCoreSet.get(r.fiscal_year)
    if (!coresInYear) {
      coresInYear = new Set()
      yearCoreSet.set(r.fiscal_year, coresInYear)
    }
    coresInYear.add(core)
  }
  const byYear = Array.from(yearFunding.entries())
    .map(([year, funding]) => ({
      year,
      funding,
      projects: yearCoreSet.get(year)?.size ?? 0,
      isPartial: isPartialFiscalYear(year),
    }))
    .sort((a, b) => b.year - a.year)

  // byCategory: project counts from deduped, funding from project totals.
  const byCategoryMap = new Map<string, { projects: number; funding: number }>()
  relevantResults.forEach((p) => {
    const category = p.primary_category || 'other'
    const core = getCoreProjectNumber(p.project_number || null)
    const projectTotal = (core && perProjectTotal.get(core)) || (p.total_cost || 0)
    const existing = byCategoryMap.get(category) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += projectTotal
    byCategoryMap.set(category, existing)
  })
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.funding - a.funding)

  // byOrg: same pattern as byCategory.
  const byOrgMap = new Map<string, { projects: number; funding: number }>()
  relevantResults.forEach((p) => {
    if (!p.org_name) return
    const core = getCoreProjectNumber(p.project_number || null)
    const projectTotal = (core && perProjectTotal.get(core)) || (p.total_cost || 0)
    const existing = byOrgMap.get(p.org_name) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += projectTotal
    byOrgMap.set(p.org_name, existing)
  })
  const byOrg = Array.from(byOrgMap.entries())
    .map(([org, data]) => ({ org, ...data }))
    .sort((a, b) => b.funding - a.funding)
    .slice(0, 15)

  // Calculate average similarity for quality reporting
  const avgSimilarity = relevantResults.reduce((sum, p) => sum + (p.similarity || 0), 0) / relevantResults.length

  console.log(
    `[Projects Agent] Processed ${items.length} projects, ` +
      `$${(totalFunding / 1e6).toFixed(1)}M total funding (sum across all budget periods), ` +
      `avg similarity: ${avgSimilarity.toFixed(3)}`
  )

  return {
    items,
    totalFunding,
    byYear,
    byCategory,
    byOrg,
    allProjectNumbers,
  }
}

/**
 * Return empty output when search fails
 */
function emptyOutput(): ProjectsAgentOutput {
  return {
    items: [],
    totalFunding: 0,
    allProjectNumbers: [],
    byYear: [],
    byCategory: [],
    byOrg: [],
  }
}

/**
 * Generate embedding using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}

// Type for raw database results
interface RawProjectResult {
  application_id: string
  project_number?: string
  title: string
  phr?: string // Public Health Relevance - the abstract equivalent
  pi_names?: string
  org_name?: string
  total_cost?: number
  fiscal_year?: number
  primary_category?: string
}
