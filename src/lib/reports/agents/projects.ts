// Projects Agent
// Searches NIH projects using pure semantic search (aligned with UI)
// Returns up to 100 projects sorted by relevance

import { supabaseAdmin } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import type { ProjectsAgentOutput, ProjectItem } from '../types'

const anthropic = new Anthropic()

// Match tier thresholds (aligned with UI - tools.ts:1067)
const THRESHOLD_BROAD = 0.20    // Low precision
const THRESHOLD_BALANCED = 0.35 // Medium precision - report population
const THRESHOLD_PRECISE = 0.50  // High precision - weighted more heavily

// Fetch at broad threshold, filter to balanced for analysis
const SEMANTIC_THRESHOLD = 0.15
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
      try {
        const parsed = JSON.parse(text.text.trim())
        return parsed.semantic_query
      } catch {
        // If JSON parse fails, try to extract semantic_query
        const match = text.text.match(/"semantic_query":\s*"([^"]+)"/)
        if (match) return match[1]
      }
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
 */
export async function runProjectsAgent(topic: string): Promise<ProjectsAgentOutput> {
  console.log(`[Projects Agent] Searching for "${topic}"`)

  // Transform topic into optimized semantic query using Claude (aligned with UI)
  const semanticQuery = await buildSemanticQuery(topic)
  console.log(`[Projects Agent] Semantic query: "${semanticQuery}"`)

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

  return processResults(relevantProjects, allProjectNumbers)
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
 * Process relevant search results into agent output
 * @param relevantResults - Deduplicated results filtered to balanced+ threshold AND topic relevance
 * @param allProjectNumbers - Project_number variants for relevant projects (for linked data lookup)
 */
function processResults(
  relevantResults: Array<RawProjectResult & { similarity?: number }>,
  allProjectNumbers: string[]
): ProjectsAgentOutput {
  const preciseCount = relevantResults.filter(p => (p.similarity || 0) >= THRESHOLD_PRECISE).length

  console.log(
    `[Projects Agent] Processing ${relevantResults.length} relevant matches ` +
    `(${preciseCount} precise, ${relevantResults.length - preciseCount} balanced)`
  )

  // Map to ProjectItem format with similarity and tier
  // Note: 'phr' field is the public health relevance (abstract equivalent)
  const items: ProjectItem[] = relevantResults.map((p) => ({
    application_id: p.application_id,
    project_number: p.project_number || null,
    title: p.title,
    abstract: p.phr || null, // PHR is the abstract equivalent in NIH data
    pi_names: p.pi_names || null,
    org_name: p.org_name || null,
    total_cost: p.total_cost || null,
    fiscal_year: p.fiscal_year || null,
    primary_category: p.primary_category || null,
    similarity: p.similarity || null,
    match_tier: p.similarity ? getMatchTier(p.similarity) : null,
  }))

  // Calculate total funding
  const totalFunding = items.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  // Group by fiscal year
  const byYearMap = new Map<number, { projects: number; funding: number }>()
  items.forEach((p) => {
    if (!p.fiscal_year) return
    const existing = byYearMap.get(p.fiscal_year) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
    byYearMap.set(p.fiscal_year, existing)
  })
  const byYear = Array.from(byYearMap.entries())
    .map(([year, data]) => ({ year, ...data }))
    .sort((a, b) => b.year - a.year)

  // Group by category
  const byCategoryMap = new Map<string, { projects: number; funding: number }>()
  items.forEach((p) => {
    const category = p.primary_category || 'other'
    const existing = byCategoryMap.get(category) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
    byCategoryMap.set(category, existing)
  })
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.funding - a.funding)

  // Group by organization
  const byOrgMap = new Map<string, { projects: number; funding: number }>()
  items.forEach((p) => {
    if (!p.org_name) return
    const existing = byOrgMap.get(p.org_name) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
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
      `$${(totalFunding / 1e6).toFixed(1)}M total funding, ` +
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
