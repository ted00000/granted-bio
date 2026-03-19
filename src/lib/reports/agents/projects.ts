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
 * Transform a topic into a semantic query using Claude
 * This ensures reports use the exact same query transformation as the UI chat
 */
async function buildSemanticQuery(topic: string): Promise<string> {
  const prompt = `You are transforming a user's search topic into a semantic query for NIH project search.

The semantic query should be natural language optimized for embedding search. Include context words like "research", "development", "approaches", etc.

Examples:
- "neural organoid platform" → "neural organoid platforms for brain research and disease modeling"
- "CRISPR gene therapy" → "CRISPR-based gene therapy approaches for treating genetic diseases"
- "mass spec for proteomics" → "mass spectrometry techniques for proteomics analysis"
- "CAR-T solid tumors" → "CAR-T cell therapy development for solid tumor cancers"
- "brain organoid electrophysiology" → "brain organoid electrophysiology research for neural activity and disease modeling"

User's topic: "${topic}"

Respond with ONLY the semantic query, nothing else.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0]
    if (text.type === 'text') {
      return text.text.trim()
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

  // Deduplicate by core project number (aligned with UI deduplication)
  // This strips budget period suffixes so "5R44MH136894-02" and "1R44MH136894-01" are treated as same project
  const seenProjects = new Map<string, RawProjectResult & { similarity?: number }>()
  for (const project of rawResults) {
    const key = getProjectDedupeKey(project)
    const existing = seenProjects.get(key)
    if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
      seenProjects.set(key, project)
    }
  }

  const uniqueResults = Array.from(seenProjects.values())
    // Re-sort by similarity after deduplication
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))

  // Filter to balanced threshold FIRST - this defines the report population
  const balancedResults = uniqueResults.filter(p => (p.similarity || 0) >= THRESHOLD_BALANCED)

  // Get core project numbers from the BALANCED subset only
  const balancedCoreNumbers = new Set<string>()
  for (const project of balancedResults) {
    const core = getCoreProjectNumber(project.project_number || null)
    if (core) balancedCoreNumbers.add(core)
  }

  // Now collect ALL project_number variants from raw results, but ONLY for projects
  // whose core number is in the balanced subset. This ensures we find linked data
  // under any variant (e.g., "5R44MH136894-02" or "1R44MH136894-01") but ONLY for
  // projects that passed the relevance threshold.
  const allProjectNumbers = rawResults
    .map(p => p.project_number)
    .filter((pn): pn is string => {
      if (!pn || pn.trim() === '') return false
      const core = getCoreProjectNumber(pn)
      return balancedCoreNumbers.has(core)
    })

  console.log(
    `[Projects Agent] Collected ${allProjectNumbers.length} project_number variants ` +
    `for ${balancedCoreNumbers.size} balanced projects`
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

  return processResults(balancedResults, allProjectNumbers)
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
 * Process balanced search results into agent output
 * @param balancedResults - Deduplicated search results already filtered to balanced+ threshold
 * @param allProjectNumbers - Project_number variants for balanced projects (for linked data lookup)
 */
function processResults(
  balancedResults: Array<RawProjectResult & { similarity?: number }>,
  allProjectNumbers: string[]
): ProjectsAgentOutput {
  const preciseCount = balancedResults.filter(p => (p.similarity || 0) >= THRESHOLD_PRECISE).length

  console.log(
    `[Projects Agent] Processing ${balancedResults.length} balanced+ matches ` +
    `(${preciseCount} precise, ${balancedResults.length - preciseCount} balanced)`
  )

  // Map to ProjectItem format with similarity and tier
  // Note: 'phr' field is the public health relevance (abstract equivalent)
  const items: ProjectItem[] = balancedResults.map((p) => ({
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
  const avgSimilarity = balancedResults.reduce((sum, p) => sum + (p.similarity || 0), 0) / balancedResults.length

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
