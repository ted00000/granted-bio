// Projects Agent
// Searches NIH projects and aggregates funding data
// Uses hybrid approach: keyword search + semantic search

import { supabaseAdmin } from '@/lib/supabase'
import type { ProjectsAgentOutput, ProjectItem } from '../types'

const UNIFIED_THRESHOLD = 0.35 // Same threshold as other agents
const MAX_RESULTS = 200 // Max unique projects to include

/**
 * Run the Projects Agent to gather project data for a topic
 * Uses hybrid approach: keyword search (title + PHR) + semantic search
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

    // 3. Semantic search
    supabaseAdmin.rpc('search_projects_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: UNIFIED_THRESHOLD,
      match_count: 200,
      min_biotools_confidence: 0,
      filter_fiscal_years: null,
      filter_categories: null,
      filter_org_types: null,
      filter_states: null,
      filter_min_funding: null,
      filter_max_funding: null,
    }),
  ])

  // Merge results, deduplicating by project_number
  const seenProjects = new Map<string, RawProjectResult>()

  // Helper to add results, keeping most recent fiscal year per project_number
  const addResults = (results: RawProjectResult[] | null) => {
    if (!results) return
    for (const project of results) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
  }

  // Add keyword results first (most specific), then semantic
  addResults(keywordTitleResult.data)
  addResults(keywordPhrResult.data)
  addResults(semanticResult.data)

  const mergedResults = Array.from(seenProjects.values())

  console.log(
    `[Projects Agent] Found ${mergedResults.length} unique projects ` +
      `(${keywordTitleResult.data?.length || 0} title, ${keywordPhrResult.data?.length || 0} phr, ` +
      `${semanticResult.data?.length || 0} semantic)`
  )

  if (mergedResults.length === 0) {
    return emptyOutput()
  }

  // Sort by funding and limit
  const sortedResults = mergedResults
    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
    .slice(0, MAX_RESULTS)

  return processResults(sortedResults)
}

/**
 * Process raw search results into agent output
 * Note: Deduplication is already done in runProjectsAgent
 */
function processResults(rawResults: RawProjectResult[]): ProjectsAgentOutput {
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

  console.log(`[Projects Agent] Processed ${items.length} unique projects, $${(totalFunding / 1e6).toFixed(1)}M total funding`)

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
