// Projects Agent
// Searches NIH projects and aggregates funding data

import { supabaseAdmin } from '@/lib/supabase'
import type { ProjectsAgentOutput, ProjectItem } from '../types'

/**
 * Run the Projects Agent to gather project data for a topic
 */
export async function runProjectsAgent(topic: string): Promise<ProjectsAgentOutput> {
  console.log(`[Projects Agent] Searching for "${topic}"`)

  // Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(topic)

  // Search for projects using semantic similarity
  const { data, error } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: queryEmbedding,
    match_threshold: 0.25, // Lower threshold for broader results
    match_count: 50,
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
    // Try fallback to basic search
    const { data: fallbackData, error: fallbackError } = await supabaseAdmin.rpc(
      'search_projects',
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.25,
        match_count: 50,
        min_biotools_confidence: 0,
      }
    )

    if (fallbackError) {
      console.error('[Projects Agent] Fallback search failed:', fallbackError)
      return emptyOutput()
    }

    return processResults(fallbackData || [])
  }

  return processResults(data || [])
}

/**
 * Process raw search results into agent output
 */
function processResults(rawResults: RawProjectResult[]): ProjectsAgentOutput {
  // Map to ProjectItem format
  const items: ProjectItem[] = rawResults.map((p) => ({
    application_id: p.application_id,
    title: p.title,
    abstract: p.abstract || null,
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

  console.log(`[Projects Agent] Found ${items.length} projects, $${(totalFunding / 1e6).toFixed(1)}M total`)

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
  title: string
  abstract?: string
  pi_names?: string
  org_name?: string
  total_cost?: number
  fiscal_year?: number
  primary_category?: string
}
