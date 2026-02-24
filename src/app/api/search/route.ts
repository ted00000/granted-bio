import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'
import type { HybridSearchParams, KeywordSearchResult, UserAccess } from '@/lib/chat/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SearchParams {
  query?: string
  categories?: string[]
  minConfidence?: number
  maxConfidence?: number
  years?: number[]
  orgTypes?: string[]
  fundingMechanisms?: string[]
  supplements?: 'all' | 'base' | 'supplements'
  page?: number
  limit?: number
  useVector?: boolean
}

// Hybrid search params for UI filtering (matches tools.ts)
interface HybridSearchRequest {
  keyword_query: string
  semantic_query: string
  filters?: {
    primary_category?: string[]
    org_type?: string[]
    state?: string[]
    min_funding?: number
    has_patents?: boolean
    has_publications?: boolean
    has_clinical_trials?: boolean
  }
  limit?: number
}

interface SearchResult {
  id: string
  application_id: string
  project_number: string
  title: string
  phr: string | null
  org_name: string | null
  org_type: string | null
  org_city: string | null
  org_state: string | null
  total_cost: number | null
  fiscal_year: number | null
  funding_mechanism: string | null
  primary_category: string | null
  biotools_confidence: number | null
  biotools_reasoning: string | null
  pi_names: string | null
  is_supplement: boolean | null
  supplement_number: string | null
  similarity?: number
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    const params: SearchParams = {
      query: searchParams.get('q') || searchParams.get('query') || undefined,
      categories: searchParams.get('categories')?.split(',').filter(Boolean) || undefined,
      minConfidence: searchParams.get('minConfidence')
        ? parseInt(searchParams.get('minConfidence')!)
        : undefined,
      maxConfidence: searchParams.get('maxConfidence')
        ? parseInt(searchParams.get('maxConfidence')!)
        : undefined,
      years: searchParams.get('years')?.split(',').map(y => parseInt(y)).filter(Boolean) || undefined,
      orgTypes: searchParams.get('orgTypes')?.split(',').filter(Boolean) || undefined,
      fundingMechanisms: searchParams.get('fundingMechanisms')?.split(',').filter(Boolean) || undefined,
      supplements: (searchParams.get('supplements') as 'all' | 'base' | 'supplements') || undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: Math.min(parseInt(searchParams.get('limit') || '20'), 100),
      useVector: searchParams.get('useVector') === 'true',
    }

    const offset = ((params.page || 1) - 1) * (params.limit || 20)

    // If query provided and vector search enabled, use vector similarity
    if (params.query && params.useVector) {
      return await vectorSearch(params)
    }

    // Otherwise use standard search with filters
    return await standardSearch(params, offset)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}

async function standardSearch(params: SearchParams, offset: number) {
  let query = supabaseAdmin
    .from('projects')
    .select(
      `
      id,
      application_id,
      project_number,
      title,
      phr,
      org_name,
      org_type,
      org_city,
      org_state,
      total_cost,
      fiscal_year,
      funding_mechanism,
      primary_category,
      biotools_confidence,
      biotools_reasoning,
      pi_names,
      is_supplement,
      supplement_number
    `,
      { count: 'exact' }
    )
    .eq('is_bio_related', true)

  // Text search on title
  if (params.query) {
    // Use ilike for simple text matching
    query = query.or(
      `title.ilike.%${params.query}%,org_name.ilike.%${params.query}%,terms.ilike.%${params.query}%`
    )
  }

  // Apply filters
  if (params.categories && params.categories.length > 0) {
    query = query.in('primary_category', params.categories)
  }

  if (params.minConfidence !== undefined) {
    query = query.gte('biotools_confidence', params.minConfidence)
  }

  if (params.maxConfidence !== undefined) {
    query = query.lte('biotools_confidence', params.maxConfidence)
  }

  if (params.years && params.years.length > 0) {
    query = query.in('fiscal_year', params.years)
  }

  if (params.orgTypes && params.orgTypes.length > 0) {
    query = query.in('org_type', params.orgTypes)
  }

  if (params.fundingMechanisms && params.fundingMechanisms.length > 0) {
    // For funding mechanisms, we need to check if any of them are in the funding_mechanism field
    const orConditions = params.fundingMechanisms.map(fm => `funding_mechanism.ilike.%${fm}%`).join(',')
    query = query.or(orConditions)
  }

  if (params.supplements) {
    if (params.supplements === 'base') {
      query = query.eq('is_supplement', false)
    } else if (params.supplements === 'supplements') {
      query = query.eq('is_supplement', true)
    }
    // 'all' means no filter
  }

  // Order by confidence descending
  query = query
    .order('biotools_confidence', { ascending: false, nullsFirst: false })
    .range(offset, offset + (params.limit || 20) - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('Supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    results: data as SearchResult[],
    total: count || 0,
    page: params.page || 1,
    limit: params.limit || 20,
    totalPages: Math.ceil((count || 0) / (params.limit || 20)),
  })
}

async function vectorSearch(params: SearchParams) {
  if (!params.query) {
    return NextResponse.json({ error: 'Query required for vector search' }, { status: 400 })
  }

  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(params.query)

    // Call the search_projects function defined in the database
    const { data, error } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: params.limit || 50,
      min_biotools_confidence: params.minConfidence || 0,
    })

    if (error) {
      console.error('Vector search error:', error)
      // Fall back to standard search
      return await standardSearch(params, 0)
    }

    return NextResponse.json({
      results: data,
      total: data?.length || 0,
      page: 1,
      limit: params.limit || 50,
      totalPages: 1,
      searchType: 'vector',
    })
  } catch (error) {
    console.error('Embedding generation error:', error)
    // Fall back to standard search
    return await standardSearch(params, 0)
  }
}

// POST endpoint for advanced search with body
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Check if this is a hybrid search request (from UI filtering)
    if (body.keyword_query && body.semantic_query) {
      return await hybridSearch(body as HybridSearchRequest)
    }

    const params: SearchParams = {
      query: body.query,
      categories: body.categories,
      minConfidence: body.minConfidence,
      maxConfidence: body.maxConfidence,
      years: body.years,
      orgTypes: body.orgTypes,
      fundingMechanisms: body.fundingMechanisms,
      supplements: body.supplements,
      page: body.page || 1,
      limit: Math.min(body.limit || 20, 100),
      useVector: body.useVector || false,
    }

    const offset = ((params.page || 1) - 1) * (params.limit || 20)

    if (params.query && params.useVector) {
      return await vectorSearch(params)
    }

    return await standardSearch(params, offset)
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}

// ============================================================================
// HYBRID SEARCH - Used by UI for filtered searches without Claude
// Mirrors the logic in src/lib/chat/tools.ts searchProjectsHybrid()
// ============================================================================

interface ProjectWithCounts {
  application_id: string
  title: string
  org_name: string | null
  org_state: string | null
  org_type: string | null
  primary_category: string | null
  secondary_category: string | null
  primary_category_confidence: number | null
  total_cost: number | null
  fiscal_year: number | null
  pi_names: string | null
  project_number: string | null
  program_officer: string | null
  activity_code: string | null
  project_end: string | null
  patent_count: number
  publication_count: number
  clinical_trial_count: number
  similarity?: number
}

// Generate singular/plural variations for a word
function generateWordVariations(word: string, originalKeyword: string): string[] {
  const variations: string[] = [word]

  // Skip short words and likely acronyms
  const originalWord = originalKeyword.split(/\s+/).find(w => w.toLowerCase() === word)
  const isAcronym = originalWord && (originalWord === originalWord.toUpperCase() || word.length <= 3)
  if (isAcronym) return variations

  // Handle common plural patterns
  if (word.endsWith('ies') && word.length > 4) {
    variations.push(word.slice(0, -3) + 'y')
  } else if (word.endsWith('es') && word.length > 4) {
    if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('zes')) {
      variations.push(word.slice(0, -2))
    }
  } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) {
    variations.push(word.slice(0, -1))
  }

  // Handle singular -> plural
  if (!word.endsWith('s') && word.length > 3) {
    if (word.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some(end => word.endsWith(end))) {
      variations.push(word.slice(0, -1) + 'ies')
    } else {
      variations.push(word + 's')
    }
  }

  return [...new Set(variations)]
}

const MAX_RESULTS_PER_WORD = 15000

// Search abstracts for a single word
async function searchAbstractsForWord(word: string, originalKeyword: string): Promise<Set<string>> {
  const variations = generateWordVariations(word, originalKeyword)
  const matchingIds = new Set<string>()

  const searchPromises = variations.map(async (variation) => {
    const ids: string[] = []
    let offset = 0
    const pageSize = 1000
    const maxPages = Math.ceil(MAX_RESULTS_PER_WORD / pageSize)
    let pageCount = 0

    while (pageCount < maxPages) {
      const { data: abstractMatches, error: abstractError } = await supabaseAdmin
        .from('abstracts')
        .select('application_id')
        .ilike('abstract_text', `%${variation}%`)
        .range(offset, offset + pageSize - 1)

      if (abstractError) throw abstractError
      if (!abstractMatches || abstractMatches.length === 0) break

      ids.push(...abstractMatches.map(a => a.application_id))
      if (abstractMatches.length < pageSize) break
      offset += pageSize
      pageCount++
    }

    return ids
  })

  const allResults = await Promise.all(searchPromises)
  allResults.forEach(ids => ids.forEach(id => matchingIds.add(id)))

  return matchingIds
}

// Search terms for a single word
async function searchTermsForWord(word: string, originalKeyword: string): Promise<Set<string>> {
  const variations = generateWordVariations(word, originalKeyword)
  const matchingIds = new Set<string>()

  try {
    const searchPromises = variations.map(async (variation) => {
      const ids: string[] = []
      let offset = 0
      const pageSize = 1000
      const maxPages = Math.ceil(MAX_RESULTS_PER_WORD / pageSize)
      let pageCount = 0

      while (pageCount < maxPages) {
        const { data: termMatches, error: termError } = await supabaseAdmin
          .from('projects')
          .select('application_id')
          .ilike('terms', `%${variation}%`)
          .range(offset, offset + pageSize - 1)

        if (termError) {
          if (termError.code === '57014') break // Timeout
          throw termError
        }
        if (!termMatches || termMatches.length === 0) break

        ids.push(...termMatches.map(a => a.application_id))
        if (termMatches.length < pageSize) break
        offset += pageSize
        pageCount++
      }

      return ids
    })

    const allResults = await Promise.all(searchPromises)
    allResults.forEach(ids => ids.forEach(id => matchingIds.add(id)))
  } catch (error) {
    console.log(`Terms search failed for word "${word}":`, error)
  }

  return matchingIds
}

// Get project IDs matching keyword search with pipe-separated synonyms
async function getKeywordMatchingIds(query: string): Promise<Set<string>> {
  const wordGroups = query.toLowerCase().trim().split(/\s+/).filter(g => g.length > 2)
  if (wordGroups.length === 0) return new Set()

  const groupMatchPromises = wordGroups.map(async (group) => {
    const synonyms = group.split('|').filter(s => s.length > 2)
    if (synonyms.length === 0) return new Set<string>()

    const synonymMatchPromises = synonyms.map(async (synonym) => {
      const [abstractMatches, termMatches] = await Promise.all([
        searchAbstractsForWord(synonym, query),
        searchTermsForWord(synonym, query)
      ])

      const combined = new Set<string>()
      abstractMatches.forEach(id => combined.add(id))
      termMatches.forEach(id => combined.add(id))
      return combined
    })

    const synonymResults = await Promise.all(synonymMatchPromises)
    const groupMatches = new Set<string>()
    for (const matches of synonymResults) {
      matches.forEach(id => groupMatches.add(id))
    }
    return groupMatches
  })

  const groupMatchResults = await Promise.all(groupMatchPromises)

  if (groupMatchResults.length === 1) return groupMatchResults[0]

  let matchingIds = groupMatchResults[0]
  for (let i = 1; i < groupMatchResults.length; i++) {
    matchingIds = new Set([...matchingIds].filter(id => groupMatchResults[i].has(id)))
  }

  return matchingIds
}

// Get semantic search results
async function getSemanticResults(query: string, limit: number): Promise<ProjectWithCounts[]> {
  const queryEmbedding = await generateEmbedding(query)

  const { data, error } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: queryEmbedding,
    match_threshold: 0.25,
    match_count: limit,
    min_biotools_confidence: 0,
    filter_fiscal_years: null,
    filter_categories: null,
    filter_org_types: null,
    filter_states: null,
    filter_min_funding: null,
    filter_max_funding: null
  })

  if (error) {
    console.warn('Semantic search fallback:', error.message)
    const { data: fallbackData } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: limit,
      min_biotools_confidence: 0
    })
    return (fallbackData || []) as ProjectWithCounts[]
  }

  return (data || []) as ProjectWithCounts[]
}

// Fetch projects by IDs
async function fetchProjectsByIds(ids: string[]): Promise<ProjectWithCounts[]> {
  if (ids.length === 0) return []

  const results: ProjectWithCounts[] = []

  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500)
    const { data } = await supabaseAdmin
      .from('projects')
      .select('application_id, title, org_name, org_state, org_type, primary_category, secondary_category, primary_category_confidence, total_cost, fiscal_year, pi_names, project_number, program_officer, activity_code, project_end, patent_count, publication_count, clinical_trial_count')
      .in('application_id', batch)

    if (data) {
      results.push(...data.map(p => ({
        ...p,
        program_officer: p.program_officer ?? null,
        activity_code: p.activity_code ?? null,
        project_end: p.project_end ?? null,
        patent_count: p.patent_count ?? 0,
        publication_count: p.publication_count ?? 0,
        clinical_trial_count: p.clinical_trial_count ?? 0
      })))
    }
  }

  return results
}

// Main hybrid search function for UI filtering
async function hybridSearch(params: HybridSearchRequest) {
  const { keyword_query, semantic_query, filters, limit = 100 } = params
  const effectiveLimit = Math.min(limit, 1000) // UI can request more than Claude

  try {
    // Run keyword and semantic searches in parallel
    const [keywordIds, semanticResults] = await Promise.all([
      getKeywordMatchingIds(keyword_query),
      getSemanticResults(semantic_query, effectiveLimit * 2)
    ])

    // Build RRF scores
    const K = 60
    const rrfScores: Map<string, { score: number; data: ProjectWithCounts | null }> = new Map()

    // Score keyword matches
    let keywordRank = 1
    for (const id of keywordIds) {
      const existing = rrfScores.get(id)
      const keywordScore = 1 / (K + keywordRank)
      if (existing) {
        existing.score += keywordScore
      } else {
        rrfScores.set(id, { score: keywordScore, data: null })
      }
      keywordRank++
    }

    // Score semantic matches
    let semanticRank = 1
    for (const result of semanticResults) {
      const existing = rrfScores.get(result.application_id)
      const semanticScore = 1 / (K + semanticRank)
      const boostedScore = semanticScore * (1 + (result.similarity || 0))
      if (existing) {
        existing.score += boostedScore
        existing.data = result
      } else {
        rrfScores.set(result.application_id, { score: boostedScore, data: result })
      }
      semanticRank++
    }

    // Fetch complete project data for ALL matches (semantic results from RPC don't have all columns)
    const allIds = [...rrfScores.keys()]
    const allProjectsData = await fetchProjectsByIds(allIds)
    const projectMap = new Map(allProjectsData.map(p => [p.application_id, p]))

    // Update RRF entries with complete project data
    for (const [id, entry] of rrfScores) {
      const fullProject = projectMap.get(id)
      if (fullProject) {
        entry.data = fullProject
      }
    }

    // Convert to array and sort by RRF score
    let allProjects = [...rrfScores.entries()]
      .filter(([, v]) => v.data !== null)
      .map(([id, v]) => ({ ...v.data!, rrf_score: v.score }))
      .sort((a, b) => b.rrf_score - a.rrf_score)

    // Apply filters
    if (filters?.primary_category?.length) {
      allProjects = allProjects.filter(p => p.primary_category && filters.primary_category!.includes(p.primary_category))
    }
    if (filters?.org_type?.length) {
      allProjects = allProjects.filter(p => p.org_type && filters.org_type!.includes(p.org_type))
    }
    if (filters?.state?.length) {
      allProjects = allProjects.filter(p => p.org_state && filters.state!.includes(p.org_state))
    }
    if (filters?.min_funding) {
      allProjects = allProjects.filter(p => (p.total_cost || 0) >= filters.min_funding!)
    }
    if (filters?.has_patents) {
      allProjects = allProjects.filter(p => (p.patent_count || 0) > 0)
    }
    if (filters?.has_publications) {
      allProjects = allProjects.filter(p => (p.publication_count || 0) > 0)
    }
    if (filters?.has_clinical_trials) {
      allProjects = allProjects.filter(p => (p.clinical_trial_count || 0) > 0)
    }

    // Deduplicate by project_number
    const seenProjects = new Map<string, typeof allProjects[0]>()
    for (const project of allProjects) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
    allProjects = [...seenProjects.values()].sort((a, b) => b.rrf_score - a.rrf_score)

    const totalBeforeCap = allProjects.length

    // Aggregate by category and org_type
    const byCategory: Record<string, number> = {}
    const byOrgType: Record<string, number> = {}

    allProjects.forEach(p => {
      const cat = p.primary_category || 'other'
      const org = p.org_type || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    // Format sample results (top 10)
    const sampleResults = allProjects.slice(0, 10).map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      secondary_category: p.secondary_category,
      primary_category_confidence: p.primary_category_confidence,
      total_cost: p.total_cost,
      pi_names: p.pi_names,
      pi_email: null,
      program_officer: p.program_officer || null,
      activity_code: p.activity_code || null,
      project_end: p.project_end || null,
      patent_count: p.patent_count || 0,
      publication_count: p.publication_count || 0,
      clinical_trial_count: p.clinical_trial_count || 0
    }))

    // All results for client-side filtering
    const allResults = allProjects.map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      secondary_category: p.secondary_category,
      primary_category_confidence: p.primary_category_confidence,
      total_cost: p.total_cost,
      pi_names: p.pi_names,
      program_officer: p.program_officer || null,
      activity_code: p.activity_code || null,
      project_end: p.project_end || null,
      patent_count: p.patent_count || 0,
      publication_count: p.publication_count || 0,
      clinical_trial_count: p.clinical_trial_count || 0
    }))

    // Generate summary
    const categoryBreakdown = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(', ')

    const orgTypeBreakdown = Object.entries(byOrgType)
      .sort(([, a], [, b]) => b - a)
      .map(([org, count]) => `${org}: ${count}`)
      .join(', ')

    const summary = `Found ${totalBeforeCap} projects. By category: ${categoryBreakdown}. By org_type: ${orgTypeBreakdown}.`

    const result: KeywordSearchResult = {
      summary,
      search_query: keyword_query,
      total_count: totalBeforeCap,
      showing_count: Math.min(totalBeforeCap, 100),
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: allResults,
      sample_results: sampleResults
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Hybrid search error:', error)
    return NextResponse.json(
      { error: 'Hybrid search failed', details: String(error) },
      { status: 500 }
    )
  }
}
