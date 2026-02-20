// Tool definitions and implementations for Claude function calling

import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'
import type {
  SearchProjectsParams,
  GetCompanyProfileParams,
  GetPIProfileParams,
  FindSimilarParams,
  SearchPatentsParams,
  GetPatentDetailsParams,
  KeywordSearchParams,
  KeywordSearchResult,
  HybridSearchParams,
  ProjectResult,
  CompanyProfile,
  PIProfile,
  PatentResult,
  PatentDetails,
  UserAccess
} from './types'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'

// Tool definitions for Claude
export const AGENT_TOOLS: Tool[] = [
  {
    name: 'search_projects',
    description: 'Search NIH projects using hybrid keyword + semantic search. Returns total count, breakdown by category and org type, and top results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword_query: {
          type: 'string',
          description: 'Query for keyword matching. Include synonyms separated by pipes: "neural|brain|cerebral organoid|organoids"'
        },
        semantic_query: {
          type: 'string',
          description: 'Natural language query for semantic/embedding search: "neural organoid platforms for brain disease research"'
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            primary_category: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by life science category: biotools, therapeutics, diagnostics, medical_device, digital_health, other'
            },
            org_type: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by organization type: company, university, hospital, research_institute'
            },
            state: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by US state codes, e.g. ["CA", "MA"]'
            },
            min_funding: {
              type: 'number',
              description: 'Minimum total funding amount'
            },
            has_patents: {
              type: 'boolean',
              description: 'Filter to only projects with at least one patent'
            },
            has_publications: {
              type: 'boolean',
              description: 'Filter to only projects with at least one publication'
            },
            has_clinical_trials: {
              type: 'boolean',
              description: 'Filter to only projects with at least one clinical trial'
            }
          }
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 100)'
        }
      },
      required: ['keyword_query', 'semantic_query']
    }
  },
  {
    name: 'get_company_profile',
    description: 'Get a comprehensive profile for an organization including all their grants, total funding, patents, publications, and clinical trials.',
    input_schema: {
      type: 'object' as const,
      properties: {
        org_name: {
          type: 'string',
          description: 'The organization name to look up (can be partial match)'
        }
      },
      required: ['org_name']
    }
  },
  {
    name: 'get_pi_profile',
    description: 'Get a profile for a principal investigator including all their grants and publications.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pi_name: {
          type: 'string',
          description: 'The PI name to look up'
        }
      },
      required: ['pi_name']
    }
  },
  {
    name: 'find_similar',
    description: 'Find projects similar to a given project based on semantic similarity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'The application_id of the source project'
        },
        limit: {
          type: 'number',
          description: 'Number of similar projects to return (default 10)'
        }
      },
      required: ['project_id']
    }
  },
  {
    name: 'search_patents',
    description: 'ONLY use when user explicitly asks about patents or IP. Search USPTO patents by keyword.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Technology area or keyword to search for in patents'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of patents to return (default 20)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_patent_details',
    description: 'Get detailed information about a specific patent from USPTO, including abstract, claims, assignees, inventors, and citations. Use this when user wants to drill into a specific patent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patent_id: {
          type: 'string',
          description: 'The USPTO patent number (e.g., "7861317" or "US7861317")'
        }
      },
      required: ['patent_id']
    }
  }
]

// Summarize project for chat context (reduces token usage)
function summarizeProject(p: ProjectResult & { patent_count?: number; publication_count?: number; clinical_trial_count?: number }) {
  // Check for SBIR/STTR - must NOT match "NON-SBIR/STTR"
  const mechanism = p.funding_mechanism?.toUpperCase() || ''
  const isNonSbir = mechanism.includes('NON-SBIR') || mechanism.includes('NON SBIR')
  const isSbir = !isNonSbir && mechanism.includes('SBIR')
  const isSttr = !isNonSbir && mechanism.includes('STTR')

  return {
    application_id: p.application_id,
    title: p.title,
    org_name: p.org_name,
    org_state: p.org_state,
    org_type: p.org_type,
    total_cost: p.total_cost,
    fiscal_year: p.fiscal_year,
    pi_names: p.pi_names,
    primary_category: p.primary_category,
    is_sbir: isSbir,
    is_sttr: isSttr,
    // Enriched counts
    patent_count: p.patent_count || 0,
    publication_count: p.publication_count || 0,
    clinical_trial_count: p.clinical_trial_count || 0
  }
}

// Tool implementations

// Keyword search - finds projects by keyword match in abstracts and terms
// Uses word-by-word AND logic: "wheat genomics" finds projects with both words
// Generate variations for a single word (singular/plural forms)
function generateWordVariations(word: string, originalKeyword: string): string[] {
  const variations: string[] = [word]

  // Skip short words and likely acronyms (all caps in original, or <= 3 chars)
  const originalWord = originalKeyword.split(/\s+/).find(w => w.toLowerCase() === word)
  const isAcronym = originalWord && (originalWord === originalWord.toUpperCase() || word.length <= 3)
  if (isAcronym) {
    return variations // Don't pluralize acronyms like CHO, DNA, RNA
  }

  // Handle common plural patterns (plural -> singular)
  if (word.endsWith('ies') && word.length > 4) {
    // antibodies -> antibody
    variations.push(word.slice(0, -3) + 'y')
  } else if (word.endsWith('es') && word.length > 4) {
    if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('zes')) {
      // analyses -> analysis, boxes -> box
      variations.push(word.slice(0, -2))
    }
  } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) {
    // cells -> cell (but not 'mass' -> 'mas', not short words)
    variations.push(word.slice(0, -1))
  }

  // Handle singular -> plural (only if not already plural)
  if (!word.endsWith('s') && word.length > 3) {
    if (word.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some(end => word.endsWith(end))) {
      // antibody -> antibodies
      variations.push(word.slice(0, -1) + 'ies')
    } else {
      // cell -> cells
      variations.push(word + 's')
    }
  }

  return [...new Set(variations)]
}

// Search abstracts for a single word (with variations), return matching application_ids
// Caps at MAX_RESULTS_PER_WORD to prevent timeouts on broad queries
const MAX_RESULTS_PER_WORD = 15000

async function searchAbstractsForWord(word: string, originalKeyword: string): Promise<Set<string>> {
  const variations = generateWordVariations(word, originalKeyword)
  const matchingIds = new Set<string>()

  // Search for each variation in parallel
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

// Search project terms for a single word (with variations), return matching application_ids
// Gracefully handles timeouts by returning empty set (falls back to abstract-only search)
async function searchTermsForWord(word: string, originalKeyword: string): Promise<Set<string>> {
  const variations = generateWordVariations(word, originalKeyword)
  const matchingIds = new Set<string>()

  try {
    // Search for each variation in parallel
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

        // Handle timeout gracefully - return what we have so far
        if (termError) {
          if (termError.code === '57014') {
            // Statement timeout - return partial results
            console.log(`Terms search timeout for variation: ${variation}`)
            break
          }
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
    // If terms search fails entirely, return empty set and continue with abstracts only
    console.log(`Terms search failed for word "${word}":`, error)
  }

  return matchingIds
}

export async function keywordSearch(
  params: KeywordSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult> {
  const { keyword, filters } = params

  try {
    // Split into individual words for AND logic
    const words = keyword.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0)

    if (words.length === 0) {
      return {
        summary: 'Found 0 projects.',
        search_query: '',
        total_count: 0,
        showing_count: 0,
        by_category: {},
        by_org_type: {},
        all_results: [],
        sample_results: []
      }
    }

    // Step 1: For each word, find projects that match in abstracts OR terms
    // Then intersect across words (AND logic)
    const wordMatchPromises = words.map(async (word) => {
      // Search both abstracts and terms for this word in parallel
      const [abstractMatches, termMatches] = await Promise.all([
        searchAbstractsForWord(word, keyword),
        searchTermsForWord(word, keyword)
      ])

      // Combine results (OR logic between abstracts and terms)
      const combinedMatches = new Set<string>()
      abstractMatches.forEach(id => combinedMatches.add(id))
      termMatches.forEach(id => combinedMatches.add(id))

      return combinedMatches
    })

    const wordMatchResults = await Promise.all(wordMatchPromises)

    // Intersect results across all words (AND logic)
    let matchingIds: Set<string>
    if (wordMatchResults.length === 1) {
      matchingIds = wordMatchResults[0]
    } else {
      // Start with first word's matches, then intersect with subsequent words
      matchingIds = wordMatchResults[0]
      for (let i = 1; i < wordMatchResults.length; i++) {
        const nextWordMatches = wordMatchResults[i]
        matchingIds = new Set([...matchingIds].filter(id => nextWordMatches.has(id)))
      }
    }

    // Convert Set to Array for further processing
    const matchingIdsArray = [...matchingIds]

    if (matchingIdsArray.length === 0) {
      return {
        summary: 'Found 0 projects.',
        search_query: '',
        total_count: 0,
        showing_count: 0,
        by_category: {},
        by_org_type: {},
        all_results: [],
        sample_results: []
      }
    }

    // Step 2: Get projects for these IDs with optional filters (parallel batches)
    // Use projects table (enriched counts will be fetched separately if available)
    const allProjects: Array<{
      application_id: string
      title: string
      org_name: string | null
      org_state: string | null
      org_type: string | null
      primary_category: string | null
      total_cost: number | null
      fiscal_year: number | null
      pi_names: string | null
      project_number: string | null
      patent_count: number
      publication_count: number
      clinical_trial_count: number
    }> = []

    // Process in batches of 500 IDs (Supabase IN clause limit)
    const idBatches: string[][] = []
    for (let i = 0; i < matchingIdsArray.length; i += 500) {
      idBatches.push(matchingIdsArray.slice(i, i + 500))
    }

    // Run all batch queries in parallel for speed
    const batchPromises = idBatches.map(async (idBatch) => {
      let query = supabaseAdmin
        .from('projects')
        .select('application_id, title, org_name, org_state, org_type, primary_category, total_cost, fiscal_year, pi_names, project_number, patent_count, publication_count, clinical_trial_count')
        .in('application_id', idBatch)

      // Apply filters
      if (filters?.primary_category?.length) {
        query = query.in('primary_category', filters.primary_category)
      }
      if (filters?.org_type?.length) {
        query = query.in('org_type', filters.org_type)
      }
      if (filters?.state?.length) {
        query = query.in('org_state', filters.state)
      }
      if (filters?.min_funding) {
        query = query.gte('total_cost', filters.min_funding)
      }
      if (filters?.has_patents) {
        query = query.gt('patent_count', 0)
      }
      if (filters?.has_publications) {
        query = query.gt('publication_count', 0)
      }
      if (filters?.has_clinical_trials) {
        query = query.gt('clinical_trial_count', 0)
      }

      return query
    })

    const batchResults = await Promise.all(batchPromises)

    for (const result of batchResults) {
      if (result.error) throw result.error
      if (result.data) {
        // Use counts from projects table if available, default to 0 if null
        allProjects.push(...result.data.map(p => ({
          ...p,
          patent_count: p.patent_count ?? 0,
          publication_count: p.publication_count ?? 0,
          clinical_trial_count: p.clinical_trial_count ?? 0
        })))
      }
    }

    // Step 3: Aggregate by category and org_type
    const byCategory: Record<string, number> = {}
    const byOrgType: Record<string, number> = {}

    allProjects.forEach(p => {
      const cat = p.primary_category || 'other'
      const org = p.org_type || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    // Step 4: Get sample results (top 10 by funding) with PI emails
    const topProjects = [...allProjects]
      .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
      .slice(0, 10)

    // Get PI emails for sample results via publications
    const projectNumbers = topProjects.map(p => p.project_number).filter(Boolean)
    let piEmails: Record<string, string> = {}

    if (projectNumbers.length > 0 && userAccess.canSeeEmails) {
      // Get pmids linked to these projects
      const { data: pubLinks } = await supabaseAdmin
        .from('project_publications')
        .select('project_number, pmid')
        .in('project_number', projectNumbers)

      if (pubLinks?.length) {
        const pmids = pubLinks.map(pl => pl.pmid)
        // Get emails from publications
        const { data: pubs } = await supabaseAdmin
          .from('publications')
          .select('pmid, pi_email')
          .in('pmid', pmids)
          .not('pi_email', 'is', null)
          .neq('pi_email', '')

        // Map project_number to email
        const pmidToEmail: Record<string, string> = {}
        pubs?.forEach(p => {
          if (p.pi_email) pmidToEmail[p.pmid] = p.pi_email
        })
        pubLinks?.forEach(pl => {
          if (pmidToEmail[pl.pmid] && !piEmails[pl.project_number]) {
            piEmails[pl.project_number] = pmidToEmail[pl.pmid]
          }
        })
      }
    }

    const sampleResults = topProjects.map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      pi_names: p.pi_names,
      pi_email: userAccess.canSeeEmails && p.project_number ? (piEmails[p.project_number] || null) : null,
      // Enriched counts from projects_enriched view
      patent_count: p.patent_count || 0,
      publication_count: p.publication_count || 0,
      clinical_trial_count: p.clinical_trial_count || 0
    }))

    // Generate natural language summary for Claude to read
    const categoryBreakdown = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(', ')

    const orgTypeBreakdown = Object.entries(byOrgType)
      .sort(([, a], [, b]) => b - a)
      .map(([org, count]) => `${org}: ${count}`)
      .join(', ')

    const summary = `Found ${allProjects.length} projects. ` +
      `By category: ${categoryBreakdown}. ` +
      `By org_type: ${orgTypeBreakdown}.`

    // All results for client-side filtering
    const allResults = allProjects.map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      pi_names: p.pi_names,
      patent_count: p.patent_count || 0,
      publication_count: p.publication_count || 0,
      clinical_trial_count: p.clinical_trial_count || 0
    }))

    return {
      summary,
      search_query: keyword,
      total_count: allProjects.length,
      showing_count: Math.min(allProjects.length, 100),
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: allResults,
      sample_results: sampleResults
    }
  } catch (error) {
    console.error('Keyword search error:', error)
    throw error
  }
}

export async function searchProjects(
  params: SearchProjectsParams,
  userAccess: UserAccess
): Promise<{ results: ReturnType<typeof summarizeProject>[], total: number }> {
  const { semantic_query, filters, limit = 10 } = params
  // Cap at 15 results for chat to avoid token overflow
  const effectiveLimit = Math.min(limit, 15, userAccess.resultsLimit)

  try {
    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(semantic_query)

    // Try optimized function with SQL-level filtering first
    const { data, error } = await supabaseAdmin.rpc('search_projects_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: effectiveLimit,
      min_biotools_confidence: 0,
      // Push filters to SQL for better performance
      filter_fiscal_years: filters?.fiscal_year?.length ? filters.fiscal_year : null,
      filter_categories: filters?.primary_category?.length ? filters.primary_category : null,
      filter_org_types: filters?.org_type?.length ? filters.org_type : null,
      filter_states: filters?.state?.length ? filters.state : null,
      filter_min_funding: filters?.min_funding ?? null,
      filter_max_funding: filters?.max_funding ?? null
    })

    if (error) {
      // Fallback to original function if optimized one doesn't exist yet
      console.warn('Optimized search not available, falling back:', error.message)
      const { data: fallbackData, error: fallbackError } = await supabaseAdmin.rpc('search_projects', {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: effectiveLimit * 2, // Get more to filter
        min_biotools_confidence: 0
      })

      if (fallbackError) throw fallbackError

      let results = fallbackData as ProjectResult[]

      // Apply filters in JS as fallback
      if (filters) {
        if (filters.fiscal_year?.length) {
          results = results.filter(p => p.fiscal_year && filters.fiscal_year!.includes(p.fiscal_year))
        }
        if (filters.primary_category?.length) {
          results = results.filter(p => p.primary_category && filters.primary_category!.includes(p.primary_category))
        }
        if (filters.org_type?.length) {
          results = results.filter(p => p.org_type && filters.org_type!.includes(p.org_type))
        }
        if (filters.min_funding !== undefined) {
          results = results.filter(p => (p.total_cost || 0) >= filters.min_funding!)
        }
        if (filters.max_funding !== undefined) {
          results = results.filter(p => (p.total_cost || 0) <= filters.max_funding!)
        }
        if (filters.state?.length) {
          results = results.filter(p => p.org_state && filters.state!.includes(p.org_state))
        }
      }

      // Note: has_patents/publications/trials filters not supported in fallback mode
      // since enrichment data isn't available here

      // Return results with default counts (enrichment requires projects_enriched view)
      const limitedResults = results.slice(0, effectiveLimit)
      const enrichedResults = limitedResults.map(r => ({
        ...r,
        patent_count: 0,
        publication_count: 0,
        clinical_trial_count: 0
      }))

      return {
        results: enrichedResults.map(summarizeProject),
        total: results.length
      }
    }

    let results = data as ProjectResult[]

    // Only apply SBIR/STTR filter in JS (not in SQL function yet)
    if (filters?.is_sbir !== undefined) {
      results = results.filter(p =>
        filters.is_sbir
          ? p.funding_mechanism?.includes('SBIR')
          : !p.funding_mechanism?.includes('SBIR')
      )
    }
    if (filters?.is_sttr !== undefined) {
      results = results.filter(p =>
        filters.is_sttr
          ? p.funding_mechanism?.includes('STTR')
          : !p.funding_mechanism?.includes('STTR')
      )
    }

    // Fetch actual counts from projects table for filtering and display
    const applicationIds = results.map(r => r.application_id)
    let countsMap: Record<string, { patent_count: number; publication_count: number; clinical_trial_count: number }> = {}

    if (applicationIds.length > 0) {
      const { data: countsData } = await supabaseAdmin
        .from('projects')
        .select('application_id, patent_count, publication_count, clinical_trial_count')
        .in('application_id', applicationIds)

      if (countsData) {
        countsData.forEach(c => {
          countsMap[c.application_id] = {
            patent_count: c.patent_count ?? 0,
            publication_count: c.publication_count ?? 0,
            clinical_trial_count: c.clinical_trial_count ?? 0
          }
        })
      }
    }

    // Apply has_patents/publications/trials filters
    if (filters?.has_patents) {
      results = results.filter(r => (countsMap[r.application_id]?.patent_count || 0) > 0)
    }
    if (filters?.has_publications) {
      results = results.filter(r => (countsMap[r.application_id]?.publication_count || 0) > 0)
    }
    if (filters?.has_clinical_trials) {
      results = results.filter(r => (countsMap[r.application_id]?.clinical_trial_count || 0) > 0)
    }

    const limitedResults = results.slice(0, effectiveLimit)

    const enrichedResults = limitedResults.map(r => ({
      ...r,
      patent_count: countsMap[r.application_id]?.patent_count || 0,
      publication_count: countsMap[r.application_id]?.publication_count || 0,
      clinical_trial_count: countsMap[r.application_id]?.clinical_trial_count || 0
    }))

    return {
      results: enrichedResults.map(summarizeProject),
      total: results.length
    }
  } catch (error) {
    console.error('Search projects error:', error)
    throw error
  }
}

// Hybrid search: combines keyword + semantic search with RRF scoring
export async function searchProjectsHybrid(
  params: HybridSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult> {
  const { keyword_query, semantic_query, filters, limit = 100 } = params
  const effectiveLimit = Math.min(limit, userAccess.resultsLimit)

  try {
    // Run keyword and semantic searches in parallel
    const [keywordIds, semanticResults] = await Promise.all([
      // Keyword search: get matching project IDs
      getKeywordMatchingIds(keyword_query),
      // Semantic search: get scored results
      getSemanticResults(semantic_query, effectiveLimit * 2) // Get more for merging
    ])

    // Build RRF (Reciprocal Rank Fusion) scores
    // RRF formula: score = sum(1 / (k + rank)) where k=60 is standard
    const K = 60
    const rrfScores: Map<string, { score: number; data: ProjectWithCounts | null }> = new Map()

    // Score keyword matches (rank by position in set - use insertion order)
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

    // Score semantic matches (already ranked by similarity)
    let semanticRank = 1
    for (const result of semanticResults) {
      const existing = rrfScores.get(result.application_id)
      const semanticScore = 1 / (K + semanticRank)
      // Boost by similarity score (0-1) for better semantic matches
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

    // Deduplicate by project_number, keeping the most recent fiscal year
    // This prevents the same project from appearing multiple times across fiscal years
    const seenProjects = new Map<string, typeof allProjects[0]>()
    for (const project of allProjects) {
      const key = project.project_number || project.application_id // fallback to application_id if no project_number
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
    allProjects = [...seenProjects.values()].sort((a, b) => b.rrf_score - a.rrf_score)

    // Store total count BEFORE capping (for display purposes)
    const totalBeforeCap = allProjects.length

    // Aggregate by category and org_type from FULL set (before cap)
    const byCategory: Record<string, number> = {}
    const byOrgType: Record<string, number> = {}

    allProjects.forEach(p => {
      const cat = p.primary_category || 'other'
      const org = p.org_type || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    // Get top 10 for Claude's sample_results
    const topProjects = allProjects.slice(0, 10)

    // Get PI emails for sample results only
    const projectNumbers = topProjects.map(p => p.project_number).filter(Boolean) as string[]
    let piEmails: Record<string, string> = {}

    if (projectNumbers.length > 0 && userAccess.canSeeEmails) {
      const { data: pubLinks } = await supabaseAdmin
        .from('project_publications')
        .select('project_number, pmid')
        .in('project_number', projectNumbers)

      if (pubLinks?.length) {
        const pmids = pubLinks.map(pl => pl.pmid)
        const { data: pubs } = await supabaseAdmin
          .from('publications')
          .select('pmid, pi_email')
          .in('pmid', pmids)
          .not('pi_email', 'is', null)
          .neq('pi_email', '')

        const pmidToEmail: Record<string, string> = {}
        pubs?.forEach(p => {
          if (p.pi_email) pmidToEmail[p.pmid] = p.pi_email
        })
        pubLinks?.forEach(pl => {
          if (pmidToEmail[pl.pmid] && !piEmails[pl.project_number]) {
            piEmails[pl.project_number] = pmidToEmail[pl.pmid]
          }
        })
      }
    }

    // Sample results (top 10) for Claude to summarize
    const sampleResults = topProjects.map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      pi_names: p.pi_names,
      pi_email: userAccess.canSeeEmails && p.project_number ? (piEmails[p.project_number] || null) : null,
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
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
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

    return {
      summary,
      search_query: keyword_query,
      total_count: totalBeforeCap,
      showing_count: Math.min(totalBeforeCap, 100), // UI shows top 100
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: allResults,
      sample_results: sampleResults
    }
  } catch (error) {
    console.error('Hybrid search error:', error)
    throw error
  }
}

// Semantic-only search: uses embedding similarity without keyword matching
// Faster, no timeouts on broad queries, conceptually-aware
export async function searchProjectsSemantic(
  params: HybridSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult> {
  const { semantic_query, filters, limit = 100 } = params
  const effectiveLimit = Math.min(limit, userAccess.resultsLimit)
  const threshold = 0.35 // Fixed semantic similarity threshold

  console.log(`[Semantic Search] Threshold: ${threshold}`)

  try {
    // Get semantic results only - no keyword search
    const semanticResults = await getSemanticResults(semantic_query, effectiveLimit * 5, threshold)
    console.log(`[Semantic Search] Results returned: ${semanticResults.length}`)

    // Fetch complete project data
    const allIds = semanticResults.map(r => r.application_id)
    const allProjectsData = await fetchProjectsByIds(allIds)
    const projectMap = new Map(allProjectsData.map(p => [p.application_id, p]))

    // Merge semantic scores with full project data
    let allProjects = semanticResults
      .map(r => {
        const fullProject = projectMap.get(r.application_id)
        return fullProject ? { ...fullProject, similarity: r.similarity || 0 } : null
      })
      .filter((p): p is ProjectWithCounts & { similarity: number } => p !== null)
      .sort((a, b) => b.similarity - a.similarity)

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

    // Deduplicate by project_number, keeping the most recent fiscal year
    const seenProjects = new Map<string, typeof allProjects[0]>()
    for (const project of allProjects) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
    allProjects = [...seenProjects.values()].sort((a, b) => b.similarity - a.similarity)

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

    // Get top 10 for sample_results
    const topProjects = allProjects.slice(0, 10)
    const projectNumbers = topProjects.map(p => p.project_number).filter(Boolean) as string[]
    let piEmails: Record<string, string> = {}

    if (projectNumbers.length > 0 && userAccess.canSeeEmails) {
      const { data: pubLinks } = await supabaseAdmin
        .from('project_publications')
        .select('project_number, pmid')
        .in('project_number', projectNumbers)

      if (pubLinks?.length) {
        const pmids = pubLinks.map(pl => pl.pmid)
        const { data: pubs } = await supabaseAdmin
          .from('publications')
          .select('pmid, pi_email')
          .in('pmid', pmids)
          .not('pi_email', 'is', null)

        const pmidToEmail: Record<string, string> = {}
        pubs?.forEach(pub => {
          if (pub.pi_email) pmidToEmail[pub.pmid] = pub.pi_email
        })

        pubLinks.forEach(pl => {
          if (pmidToEmail[pl.pmid] && !piEmails[pl.project_number]) {
            piEmails[pl.project_number] = pmidToEmail[pl.pmid]
          }
        })
      }
    }

    const sampleResults = topProjects.map(p => ({
      application_id: p.application_id,
      title: p.title,
      org_name: p.org_name,
      org_state: p.org_state,
      org_type: p.org_type,
      primary_category: p.primary_category,
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      pi_names: p.pi_names,
      pi_email: userAccess.canSeeEmails && p.project_number ? (piEmails[p.project_number] || null) : null,
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
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      pi_names: p.pi_names,
      program_officer: p.program_officer || null,
      activity_code: p.activity_code || null,
      project_end: p.project_end || null,
      patent_count: p.patent_count || 0,
      publication_count: p.publication_count || 0,
      clinical_trial_count: p.clinical_trial_count || 0
    }))

    const categoryBreakdown = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(', ')

    const orgTypeBreakdown = Object.entries(byOrgType)
      .sort(([, a], [, b]) => b - a)
      .map(([org, count]) => `${org}: ${count}`)
      .join(', ')

    const summary = `Found ${totalBeforeCap} projects. By category: ${categoryBreakdown}. By org_type: ${orgTypeBreakdown}.`

    return {
      summary,
      search_query: semantic_query,
      total_count: totalBeforeCap,
      showing_count: Math.min(totalBeforeCap, 100),
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: allResults,
      sample_results: sampleResults
    }
  } catch (error) {
    console.error('Semantic search error:', error)
    throw error
  }
}

// Helper type for projects with counts
interface ProjectWithCounts {
  application_id: string
  title: string
  org_name: string | null
  org_state: string | null
  org_type: string | null
  primary_category: string | null
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

// Helper: Get project IDs matching keyword search
// Supports pipe-separated synonyms: "neural|brain|cerebral organoids"
// Groups are AND'd together, synonyms within a group are OR'd
async function getKeywordMatchingIds(query: string): Promise<Set<string>> {
  // Split into word groups (space-separated)
  const wordGroups = query.toLowerCase().trim().split(/\s+/).filter(g => g.length > 2)

  if (wordGroups.length === 0) return new Set()

  // For each word group, find matching project IDs
  // Within a group, pipe-separated synonyms use OR logic
  const groupMatchPromises = wordGroups.map(async (group) => {
    // Split by pipe to get synonyms (e.g., "neural|brain|cerebral" -> ["neural", "brain", "cerebral"])
    const synonyms = group.split('|').filter(s => s.length > 2)

    if (synonyms.length === 0) return new Set<string>()

    // Search all synonyms in parallel (OR logic within group)
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

    // Union all synonym matches (OR logic)
    const groupMatches = new Set<string>()
    for (const matches of synonymResults) {
      matches.forEach(id => groupMatches.add(id))
    }
    return groupMatches
  })

  const groupMatchResults = await Promise.all(groupMatchPromises)

  // Intersect results across groups (AND logic)
  if (groupMatchResults.length === 1) return groupMatchResults[0]

  let matchingIds = groupMatchResults[0]
  for (let i = 1; i < groupMatchResults.length; i++) {
    matchingIds = new Set([...matchingIds].filter(id => groupMatchResults[i].has(id)))
  }

  return matchingIds
}

// Helper: Get semantic search results with similarity scores
async function getSemanticResults(query: string, limit: number, threshold: number = 0.25): Promise<ProjectWithCounts[]> {
  const queryEmbedding = await generateEmbedding(query)

  const { data, error } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
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
    // Fallback to basic search
    const { data: fallbackData } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      min_biotools_confidence: 0
    })
    return (fallbackData || []) as ProjectWithCounts[]
  }

  return (data || []) as ProjectWithCounts[]
}

// Helper: Fetch full project data for given IDs
async function fetchProjectsByIds(ids: string[]): Promise<ProjectWithCounts[]> {
  if (ids.length === 0) return []

  const results: ProjectWithCounts[] = []

  // Process in batches of 500
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500)
    const { data } = await supabaseAdmin
      .from('projects')
      .select('application_id, title, org_name, org_state, org_type, primary_category, total_cost, fiscal_year, pi_names, project_number, program_officer, activity_code, project_end, patent_count, publication_count, clinical_trial_count')
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

// Summarize company profile for chat context
function summarizeCompanyProfile(profile: CompanyProfile) {
  return {
    org_name: profile.org_name,
    total_funding: profile.total_funding,
    project_count: profile.project_count,
    patent_count: profile.patent_count,
    publication_count: profile.publication_count,
    clinical_trial_count: profile.clinical_trial_count,
    primary_categories: profile.primary_categories,
    fiscal_years: profile.fiscal_years,
    // Only include top 5 projects summarized
    top_projects: profile.projects.slice(0, 5).map(p => ({
      title: p.title,
      total_cost: p.total_cost,
      fiscal_year: p.fiscal_year,
      primary_category: p.primary_category
    }))
  }
}

export async function getCompanyProfile(
  params: GetCompanyProfileParams,
  userAccess: UserAccess
): Promise<ReturnType<typeof summarizeCompanyProfile> | null> {
  const { org_name } = params

  try {
    // Find projects for this organization
    const { data: projects, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .ilike('org_name', `%${org_name}%`)
      .order('fiscal_year', { ascending: false })

    if (projectsError) throw projectsError

    if (!projects?.length) {
      return null
    }

    // Get the canonical org name from first result
    const canonicalOrgName = projects[0].org_name

    // Get patent count
    const projectNumbers = projects.map(p => p.project_number).filter(Boolean)
    const { count: patentCount } = await supabaseAdmin
      .from('patents')
      .select('*', { count: 'exact', head: true })
      .in('project_number', projectNumbers)

    // Get publication count
    const { count: pubCount } = await supabaseAdmin
      .from('project_publications')
      .select('*', { count: 'exact', head: true })
      .in('project_number', projectNumbers)

    // Get clinical trial count
    const { count: trialCount } = await supabaseAdmin
      .from('clinical_studies')
      .select('*', { count: 'exact', head: true })
      .in('project_number', projectNumbers)

    // Aggregate stats
    const totalFunding = projects.reduce((sum, p) => sum + (p.total_cost || 0), 0)
    const categories: Record<string, number> = {}
    const fiscalYears = new Set<number>()
    const states = new Set<string>()

    projects.forEach(p => {
      if (p.primary_category) {
        categories[p.primary_category] = (categories[p.primary_category] || 0) + 1
      }
      if (p.fiscal_year) fiscalYears.add(p.fiscal_year)
      if (p.org_state) states.add(p.org_state)
    })

    const profile: CompanyProfile = {
      org_name: canonicalOrgName || org_name,
      total_funding: totalFunding,
      project_count: projects.length,
      patent_count: patentCount || 0,
      publication_count: pubCount || 0,
      clinical_trial_count: trialCount || 0,
      projects: projects.slice(0, 10) as ProjectResult[],
      primary_categories: categories,
      fiscal_years: Array.from(fiscalYears).sort((a, b) => b - a),
      states: Array.from(states)
    }
    // Return summarized version for chat context
    return summarizeCompanyProfile(profile)
  } catch (error) {
    console.error('Get company profile error:', error)
    throw error
  }
}

// Summarized PI profile type for chat
type SummarizedPIProfile = {
  pi_name: string
  organizations: string[]
  total_funding: number
  project_count: number
  publication_count: number
  top_projects: Array<{
    title: string
    org_name: string | null
    total_cost: number | null
    fiscal_year: number | null
    primary_category: string | null
  }>
}

// Helper to extract the actual PI name from pi_names field
// pi_names format: "LASTNAME, FIRSTNAME M. (contact)" or "LASTNAME, FIRSTNAME;OTHER, NAME"
function extractPIName(piNames: string | null, searchPattern: string): string | null {
  if (!piNames) return null

  // Split by semicolon for multiple PIs
  const pis = piNames.split(';').map(p => p.trim())

  // Find the one matching our search pattern
  const patternLower = searchPattern.toLowerCase()
  for (const pi of pis) {
    if (pi.toLowerCase().includes(patternLower)) {
      // Remove "(contact)" suffix and clean up
      return pi.replace(/\s*\(contact\)\s*/i, '').trim()
    }
  }

  // If no match, return the first PI (primary)
  return pis[0]?.replace(/\s*\(contact\)\s*/i, '').trim() || null
}

// Helper to generate name search patterns for PI lookup
// Database stores names as "LASTNAME, FIRSTNAME M." or "LASTNAME, FIRSTNAME"
function generateNamePatterns(name: string): string[] {
  const patterns: string[] = []
  const cleaned = name.trim()

  // Always include the original
  patterns.push(cleaned)

  // Check if already in "Last, First" format
  if (cleaned.includes(',')) {
    const [last, first] = cleaned.split(',').map(s => s.trim())
    patterns.push(last) // Just last name
    if (first) {
      // Handle "Last, First M." -> try "First Last" too
      const firstPart = first.split(' ')[0] // Get first name without middle
      patterns.push(`${firstPart} ${last}`)
      patterns.push(`${last}, ${firstPart}`)
    }
  } else {
    // Assume "First Last" or "First M. Last" format
    const parts = cleaned.split(/\s+/)
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1]
      const firstName = parts[0]
      // Try "LASTNAME, FIRSTNAME" format (how DB stores it)
      patterns.push(`${lastName}, ${firstName}`)
      patterns.push(lastName) // Just last name as fallback
    }
  }

  // Dedupe and filter empty
  return [...new Set(patterns)].filter(p => p.length > 0)
}

export async function getPIProfile(
  params: GetPIProfileParams,
  userAccess: UserAccess
): Promise<SummarizedPIProfile | null> {
  const { pi_name } = params

  try {
    // Generate multiple name patterns to handle different formats
    const namePatterns = generateNamePatterns(pi_name)

    // Try each pattern until we find matches
    let projects: Array<{
      org_name: string | null
      project_number: string | null
      total_cost: number | null
      title: string
      fiscal_year: number | null
      primary_category: string | null
      pi_names: string | null
    }> | null = null
    let matchedPattern: string | null = null

    for (const pattern of namePatterns) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('org_name, project_number, total_cost, title, fiscal_year, primary_category, pi_names')
        .ilike('pi_names', `%${pattern}%`)
        .order('fiscal_year', { ascending: false })

      if (error) throw error

      if (data?.length) {
        projects = data
        matchedPattern = pattern
        break
      }
    }

    if (!projects?.length) {
      return null
    }

    // Extract the actual PI name from the matched record for consistency
    const actualPiName = extractPIName(projects[0].pi_names, matchedPattern || pi_name) || pi_name

    // Get unique organizations
    const organizations = [...new Set(projects.map(p => p.org_name).filter(Boolean))]

    // Get publication count for this PI's projects
    const projectNumbers = projects.map(p => p.project_number).filter(Boolean)
    const { count: pubCount } = await supabaseAdmin
      .from('project_publications')
      .select('*', { count: 'exact', head: true })
      .in('project_number', projectNumbers)

    const totalFunding = projects.reduce((sum, p) => sum + (p.total_cost || 0), 0)

    return {
      pi_name: actualPiName,
      organizations: organizations as string[],
      total_funding: totalFunding,
      project_count: projects.length,
      publication_count: pubCount || 0,
      // Only return top 5 projects summarized
      top_projects: projects.slice(0, 5).map(p => ({
        title: p.title,
        org_name: p.org_name,
        total_cost: p.total_cost,
        fiscal_year: p.fiscal_year,
        primary_category: p.primary_category
      }))
    }
  } catch (error) {
    console.error('Get PI profile error:', error)
    throw error
  }
}

export async function findSimilar(
  params: FindSimilarParams,
  userAccess: UserAccess
): Promise<ReturnType<typeof summarizeProject>[]> {
  const { project_id, limit = 10 } = params
  // Cap at 10 for chat context
  const effectiveLimit = Math.min(limit, 10, userAccess.resultsLimit)

  try {
    // Get the source project's embedding (use abstract_embedding for best semantic match)
    const { data: sourceProject, error: sourceError } = await supabaseAdmin
      .from('projects')
      .select('abstract_embedding, title_embedding, title')
      .eq('application_id', project_id)
      .single()

    if (sourceError) {
      throw new Error('Project not found')
    }

    // Prefer abstract embedding, fall back to title embedding
    const embedding = sourceProject?.abstract_embedding || sourceProject?.title_embedding
    if (!embedding) {
      throw new Error('Project has no embedding for similarity search')
    }

    // Search for similar projects
    const { data, error } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: embedding,
      match_threshold: 0.6,
      match_count: effectiveLimit + 1, // +1 to exclude self
      min_biotools_confidence: 0
    })

    if (error) throw error

    // Filter out the source project
    const results = (data as ProjectResult[]).filter(
      p => p.application_id !== project_id
    )

    return results.slice(0, effectiveLimit).map(summarizeProject)
  } catch (error) {
    console.error('Find similar error:', error)
    throw error
  }
}

export async function searchPatents(
  params: SearchPatentsParams,
  userAccess: UserAccess
): Promise<PatentResult[]> {
  const { query, limit = 10 } = params
  // Cap at 20 for hybrid search, will dedupe
  const effectiveLimit = Math.min(limit, 20, userAccess.resultsLimit)

  try {
    // Run HYBRID search: semantic + keyword
    // Patent titles are short so semantic alone misses many relevant results

    // 1. Semantic search with low threshold
    const queryEmbedding = await generateEmbedding(query)
    const semanticPromise = supabaseAdmin.rpc('search_patents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: effectiveLimit
    })

    // 2. Keyword search on title - split query into words for OR matching
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const keywordPromise = supabaseAdmin
      .from('patents')
      .select('patent_id, patent_title, project_number')
      .or(queryWords.map(word => `patent_title.ilike.%${word}%`).join(','))
      .limit(effectiveLimit)

    // Run both in parallel
    const [semanticResult, keywordResult] = await Promise.all([semanticPromise, keywordPromise])

    // Merge results, prioritizing semantic matches
    const seenIds = new Set<string>()
    const merged: PatentResult[] = []

    // Add semantic results first (they have similarity scores)
    if (semanticResult.data) {
      for (const patent of semanticResult.data as PatentResult[]) {
        if (!seenIds.has(patent.patent_id)) {
          seenIds.add(patent.patent_id)
          merged.push(patent)
        }
      }
    }

    // Add keyword results that weren't in semantic results
    if (keywordResult.data) {
      for (const patent of keywordResult.data as PatentResult[]) {
        if (!seenIds.has(patent.patent_id)) {
          seenIds.add(patent.patent_id)
          // No similarity score for keyword matches
          merged.push({ ...patent, similarity: undefined })
        }
      }
    }

    // Return up to the limit
    return merged.slice(0, effectiveLimit)
  } catch (error) {
    console.error('Search patents error:', error)
    throw error
  }
}

// Get detailed patent info from USPTO PatentsView API
export async function getPatentDetails(
  params: GetPatentDetailsParams,
  userAccess: UserAccess
): Promise<PatentDetails | null> {
  const { patent_id } = params

  // Clean up patent ID - remove US prefix if present
  const cleanPatentId = patent_id.replace(/^US/i, '').replace(/[^0-9]/g, '')

  const apiKey = process.env.USPTO_API_KEY
  if (!apiKey) {
    console.error('USPTO_API_KEY not configured')
    throw new Error('USPTO API not configured')
  }

  try {
    // Query PatentsView API
    const query = encodeURIComponent(JSON.stringify({ patent_id: cleanPatentId }))
    const fields = encodeURIComponent(JSON.stringify([
      'patent_id',
      'patent_title',
      'patent_abstract',
      'patent_date',
      'patent_type',
      'assignees.assignee_organization',
      'inventors.inventor_name_first',
      'inventors.inventor_name_last',
      'cpcs.cpc_group_id',
      'pct_data.us_371c124_date'
    ]))

    const url = `https://search.patentsview.org/api/v1/patent/?q=${query}&f=${fields}`

    const response = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('USPTO API rate limit exceeded. Try again in a minute.')
      }
      throw new Error(`USPTO API error: ${response.status}`)
    }

    const data = await response.json()

    if (!data.patents || data.patents.length === 0) {
      return null
    }

    const patent = data.patents[0]

    // Get citation count with a separate query
    let citedByCount = 0
    try {
      const citQuery = encodeURIComponent(JSON.stringify({
        _and: [{ cited_patent_id: cleanPatentId }]
      }))
      const citUrl = `https://search.patentsview.org/api/v1/patent/?q=${citQuery}&o={"size":0}`
      const citResponse = await fetch(citUrl, {
        headers: { 'X-Api-Key': apiKey }
      })
      if (citResponse.ok) {
        const citData = await citResponse.json()
        citedByCount = citData.total_hits || 0
      }
    } catch {
      // Citation count is optional, continue without it
    }

    // Check if we have this patent linked to an NIH project
    const { data: localPatent } = await supabaseAdmin
      .from('patents')
      .select('project_number')
      .eq('patent_id', cleanPatentId)
      .single()

    const result: PatentDetails = {
      patent_id: patent.patent_id,
      patent_title: patent.patent_title || null,
      patent_abstract: patent.patent_abstract || null,
      patent_date: patent.patent_date || null,
      patent_type: patent.patent_type || null,
      assignees: patent.assignees?.map((a: { assignee_organization: string }) => a.assignee_organization).filter(Boolean) || [],
      inventors: patent.inventors?.map((i: { inventor_name_first: string; inventor_name_last: string }) =>
        `${i.inventor_name_first} ${i.inventor_name_last}`.trim()
      ).filter(Boolean) || [],
      cpc_codes: patent.cpcs?.map((c: { cpc_group_id: string }) => c.cpc_group_id).filter(Boolean).slice(0, 5) || [],
      cited_by_count: citedByCount,
      claims_count: 0, // Not readily available from API
      linked_project_number: localPatent?.project_number || null
    }

    return result
  } catch (error) {
    console.error('Get patent details error:', error)
    throw error
  }
}

// Tool execution dispatcher
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  userAccess: UserAccess
): Promise<unknown> {
  switch (toolName) {
    case 'search_projects':
      // Uses semantic-only search (embedding similarity, no keyword matching)
      return searchProjectsSemantic(args as unknown as HybridSearchParams, userAccess)
    case 'get_company_profile':
      return getCompanyProfile(args as unknown as GetCompanyProfileParams, userAccess)
    case 'get_pi_profile':
      return getPIProfile(args as unknown as GetPIProfileParams, userAccess)
    case 'find_similar':
      return findSimilar(args as unknown as FindSimilarParams, userAccess)
    case 'search_patents':
      return searchPatents(args as unknown as SearchPatentsParams, userAccess)
    case 'get_patent_details':
      return getPatentDetails(args as unknown as GetPatentDetailsParams, userAccess)
    // Legacy support for old tool names
    case 'keyword_search':
      // Redirect to semantic search
      const keywordArgs = args as unknown as KeywordSearchParams
      return searchProjectsSemantic({
        keyword_query: keywordArgs.keyword,
        semantic_query: keywordArgs.keyword,
        filters: keywordArgs.filters
      }, userAccess)
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}
