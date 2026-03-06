// Projects Agent
// Searches NIH projects and aggregates funding data
// Uses hybrid approach: keyword search + semantic search
// Applies percentile-based filtering for high-confidence results

import { supabaseAdmin } from '@/lib/supabase'
import type { ProjectsAgentOutput, ProjectItem } from '../types'

// Low threshold to maximize recall - quality comes from percentile filtering
const SEMANTIC_THRESHOLD = 0.15
// Target ~75 projects (top 40% of ~200 candidates)
const TARGET_PERCENTILE = 0.40
const MIN_PROJECTS = 50
const MAX_PROJECTS = 100

/**
 * Run the Projects Agent to gather project data for a topic
 * Uses hybrid approach: keyword search (title + PHR) + semantic search
 * Applies percentile-based filtering for high-confidence results
 */
export async function runProjectsAgent(topic: string): Promise<ProjectsAgentOutput> {
  console.log(`[Projects Agent] Searching for "${topic}"`)

  // Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(topic)

  // Extract primary search term (most specific part of query)
  const primaryTerm = topic.split(/\s+/)[0] // e.g., "CAR-T" from "CAR-T cell therapy"

  // Build keyword search conditions for multiple term variations
  const searchVariations = [primaryTerm]
  if (primaryTerm.includes('-')) {
    searchVariations.push(primaryTerm.replace('-', ' ')) // CAR-T -> CAR T
  }

  // Run three searches in parallel
  const [keywordTitleResult, keywordPhrResult, semanticResult] = await Promise.all([
    // 1. Keyword search on title
    supabaseAdmin
      .from('projects')
      .select(
        'application_id, project_number, title, phr, pi_names, org_name, total_cost, fiscal_year, primary_category'
      )
      .or(searchVariations.map((v) => `title.ilike.%${v}%`).join(','))
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false })
      .limit(300),

    // 2. Keyword search on PHR (abstract equivalent)
    supabaseAdmin
      .from('projects')
      .select(
        'application_id, project_number, title, phr, pi_names, org_name, total_cost, fiscal_year, primary_category'
      )
      .or(searchVariations.map((v) => `phr.ilike.%${v}%`).join(','))
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false })
      .limit(300),

    // 3. Semantic search with low threshold - captures similarity scores
    supabaseAdmin.rpc('search_projects_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: SEMANTIC_THRESHOLD,
      match_count: 500, // Get more candidates for percentile filtering
      min_biotools_confidence: 0,
      filter_fiscal_years: null,
      filter_categories: null,
      filter_org_types: null,
      filter_states: null,
      filter_min_funding: null,
      filter_max_funding: null,
    }),
  ])

  // Build similarity map from semantic results
  const similarityMap = new Map<string, number>()
  if (semanticResult.data) {
    for (const project of semanticResult.data as Array<RawProjectResult & { similarity?: number }>) {
      if (project.similarity !== undefined) {
        similarityMap.set(project.application_id, project.similarity)
      }
    }
  }

  // Merge results, deduplicating by project_number
  const seenProjects = new Map<string, RawProjectResult & { similarity?: number }>()

  // Helper to add results, keeping most recent fiscal year per project_number
  const addResults = (results: RawProjectResult[] | null, addSimilarity: boolean = false) => {
    if (!results) return
    for (const project of results) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        const similarity = addSimilarity
          ? (project as RawProjectResult & { similarity?: number }).similarity
          : similarityMap.get(project.application_id)
        seenProjects.set(key, { ...project, similarity })
      }
    }
  }

  // Add keyword results first (most specific), then semantic (with similarity)
  addResults(keywordTitleResult.data)
  addResults(keywordPhrResult.data)
  addResults(semanticResult.data, true)

  const mergedResults = Array.from(seenProjects.values())

  console.log(
    `[Projects Agent] Found ${mergedResults.length} unique projects ` +
      `(${keywordTitleResult.data?.length || 0} title, ${keywordPhrResult.data?.length || 0} phr, ` +
      `${semanticResult.data?.length || 0} semantic)`
  )

  if (mergedResults.length === 0) {
    return emptyOutput()
  }

  // Apply percentile-based filtering for high-confidence results
  // Sort by similarity (highest first), then by funding as tiebreaker
  const sortedBySimilarity = mergedResults
    .sort((a, b) => {
      const simDiff = (b.similarity || 0) - (a.similarity || 0)
      if (Math.abs(simDiff) > 0.01) return simDiff
      return (b.total_cost || 0) - (a.total_cost || 0)
    })

  // Calculate percentile cutoff
  const percentileCutoff = Math.ceil(sortedBySimilarity.length * TARGET_PERCENTILE)
  const targetCount = Math.min(Math.max(percentileCutoff, MIN_PROJECTS), MAX_PROJECTS)
  const filteredResults = sortedBySimilarity.slice(0, targetCount)

  // Log similarity score distribution
  const similarities = filteredResults.map(p => p.similarity || 0)
  const minSim = Math.min(...similarities)
  const maxSim = Math.max(...similarities)
  const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length

  console.log(
    `[Projects Agent] Applied percentile filter: ${mergedResults.length} → ${filteredResults.length} projects ` +
      `(similarity range: ${minSim.toFixed(3)} - ${maxSim.toFixed(3)}, avg: ${avgSim.toFixed(3)})`
  )

  return processResults(filteredResults)
}

/**
 * Process raw search results into agent output
 * Note: Deduplication and percentile filtering already done in runProjectsAgent
 */
function processResults(rawResults: Array<RawProjectResult & { similarity?: number }>): ProjectsAgentOutput {
  // Map to ProjectItem format
  // Note: 'phr' field is the public health relevance (abstract equivalent)
  const items: ProjectItem[] = rawResults.map((p) => ({
    application_id: p.application_id,
    title: p.title,
    abstract: p.phr || null, // PHR is the abstract equivalent in NIH data
    pi_names: p.pi_names || null,
    org_name: p.org_name || null,
    total_cost: p.total_cost || null,
    fiscal_year: p.fiscal_year || null,
    primary_category: p.primary_category || null,
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
  const avgSimilarity = rawResults.reduce((sum, p) => sum + (p.similarity || 0), 0) / rawResults.length

  console.log(
    `[Projects Agent] Processed ${items.length} high-confidence projects, ` +
      `$${(totalFunding / 1e6).toFixed(1)}M total funding, ` +
      `avg similarity: ${avgSimilarity.toFixed(3)}`
  )

  return {
    items,
    totalFunding,
    byYear,
    byCategory,
    byOrg,
  }
}

/**
 * Return empty output when search fails
 */
function emptyOutput(): ProjectsAgentOutput {
  return {
    items: [],
    totalFunding: 0,
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
