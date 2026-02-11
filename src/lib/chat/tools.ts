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
    name: 'keyword_search',
    description: 'Search NIH projects by keyword in abstracts. Returns total count and breakdown by life science category and organization type. Use this FIRST when user mentions a specific technology, method, or term (e.g., "mass spectrometry", "CRISPR", "proteomics"). This gives you counts to report back before drilling down.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: 'The keyword or phrase to search for in project abstracts (e.g., "mass spectrometry", "CRISPR", "CAR-T")'
        },
        filters: {
          type: 'object',
          description: 'Optional filters to apply after keyword search',
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
            }
          }
        }
      },
      required: ['keyword']
    }
  },
  {
    name: 'search_projects',
    description: 'Search NIH projects using semantic similarity and filters. Use this for broad conceptual searches where exact keyword matching is not needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query describing the research area or technology'
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            fiscal_year: {
              type: 'array',
              items: { type: 'number' },
              description: 'Filter by fiscal year(s), e.g. [2024, 2025]'
            },
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
            is_sbir: {
              type: 'boolean',
              description: 'Filter to SBIR grants only'
            },
            is_sttr: {
              type: 'boolean',
              description: 'Filter to STTR grants only'
            },
            min_funding: {
              type: 'number',
              description: 'Minimum total funding amount'
            },
            max_funding: {
              type: 'number',
              description: 'Maximum total funding amount'
            },
            state: {
              type: 'array',
              items: { type: 'string' },
              description: 'Two-letter US state codes, e.g. ["CA", "MA", "NY"]. Leave empty for all states.'
            }
          }
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 25)'
        }
      },
      required: ['query']
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
    description: 'Search patents by technology area or keyword.',
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

// Keyword search - finds projects by exact keyword match in abstracts
// Uses parallel client-side queries for reliability
// Generate keyword variations for more robust search
// Handles plural/singular forms for common scientific terms
function generateKeywordVariations(keyword: string): string[] {
  const variations = new Set<string>()
  const words = keyword.toLowerCase().trim().split(/\s+/)

  // Always include original (lowercase for case-insensitive matching)
  variations.add(keyword.toLowerCase())

  // Process each word for singular/plural variations
  const processedWords = words.map(word => {
    const wordVariations: string[] = [word]

    // Skip short words and likely acronyms (all caps in original, or <= 3 chars)
    const originalWord = keyword.split(/\s+/).find(w => w.toLowerCase() === word)
    const isAcronym = originalWord && (originalWord === originalWord.toUpperCase() || word.length <= 3)
    if (isAcronym) {
      return wordVariations // Don't pluralize acronyms like CHO, DNA, RNA
    }

    // Handle common plural patterns (plural -> singular)
    if (word.endsWith('ies') && word.length > 4) {
      // antibodies -> antibody
      wordVariations.push(word.slice(0, -3) + 'y')
    } else if (word.endsWith('es') && word.length > 4) {
      if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('zes')) {
        // analyses -> analysis, boxes -> box
        wordVariations.push(word.slice(0, -2))
      }
    } else if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) {
      // cells -> cell (but not 'mass' -> 'mas', not short words)
      wordVariations.push(word.slice(0, -1))
    }

    // Handle singular -> plural (only if not already plural)
    if (!word.endsWith('s') && word.length > 3) {
      if (word.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some(end => word.endsWith(end))) {
        // antibody -> antibodies
        wordVariations.push(word.slice(0, -1) + 'ies')
      } else {
        // cell -> cells
        wordVariations.push(word + 's')
      }
    }

    return [...new Set(wordVariations)] // dedupe
  })

  // Generate combinations (limit to avoid explosion)
  if (words.length <= 3) {
    const generateCombinations = (wordIndex: number, current: string[]): void => {
      if (wordIndex === processedWords.length) {
        variations.add(current.join(' '))
        return
      }
      for (const variant of processedWords[wordIndex]) {
        generateCombinations(wordIndex + 1, [...current, variant])
      }
    }
    generateCombinations(0, [])
  }

  return [...variations]
}

export async function keywordSearch(
  params: KeywordSearchParams,
  userAccess: UserAccess
): Promise<KeywordSearchResult> {
  const { keyword, filters } = params

  try {
    // Generate keyword variations to handle plural/singular forms
    const keywordVariations = generateKeywordVariations(keyword)

    // Step 1: Search abstracts for all keyword variations, get all application_ids
    const matchingIds = new Set<string>()

    // Search for each variation in parallel
    const searchPromises = keywordVariations.map(async (variation) => {
      const ids: string[] = []
      let offset = 0
      const pageSize = 1000

      while (true) {
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
      }

      return ids
    })

    const allResults = await Promise.all(searchPromises)
    allResults.forEach(ids => ids.forEach(id => matchingIds.add(id)))

    // Convert Set to Array for further processing
    const matchingIdsArray = [...matchingIds]

    if (matchingIdsArray.length === 0) {
      return {
        summary: 'Found 0 projects.',
        total_count: 0,
        by_category: {},
        by_org_type: {},
        sample_results: []
      }
    }

    // Step 2: Get projects for these IDs with optional filters (parallel batches)
    // Use projects_enriched view to get patent/publication/trial counts
    const allProjects: Array<{
      application_id: string
      title: string
      org_name: string | null
      org_state: string | null
      org_type: string | null
      primary_category: string | null
      total_cost: number | null
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
        .from('projects_enriched')
        .select('application_id, title, org_name, org_state, org_type, primary_category, total_cost, pi_names, project_number, patent_count, publication_count, clinical_trial_count')
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

      return query
    })

    const batchResults = await Promise.all(batchPromises)

    for (const result of batchResults) {
      if (result.error) throw result.error
      if (result.data) {
        allProjects.push(...result.data)
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

    return {
      summary, // Natural language summary for Claude to read
      total_count: allProjects.length,
      by_category: byCategory,
      by_org_type: byOrgType,
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
  const { query, filters, limit = 10 } = params
  // Cap at 15 results for chat to avoid token overflow
  const effectiveLimit = Math.min(limit, 15, userAccess.resultsLimit)

  try {
    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(query)

    // Try optimized function with SQL-level filtering first
    const { data, error } = await supabaseAdmin.rpc('search_projects_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
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
        match_threshold: 0.5,
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

      // Enrich results with patent/publication/trial counts
      const limitedResults = results.slice(0, effectiveLimit)
      const appIds = limitedResults.map(r => r.application_id)

      const { data: enrichedData } = await supabaseAdmin
        .from('projects_enriched')
        .select('application_id, patent_count, publication_count, clinical_trial_count')
        .in('application_id', appIds)

      const enrichedMap = new Map(
        (enrichedData || []).map(e => [e.application_id, e])
      )

      const enrichedResults = limitedResults.map(r => ({
        ...r,
        patent_count: enrichedMap.get(r.application_id)?.patent_count || 0,
        publication_count: enrichedMap.get(r.application_id)?.publication_count || 0,
        clinical_trial_count: enrichedMap.get(r.application_id)?.clinical_trial_count || 0
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

    // Enrich results with patent/publication/trial counts from projects_enriched
    const limitedResults = results.slice(0, effectiveLimit)
    const appIds = limitedResults.map(r => r.application_id)

    const { data: enrichedData } = await supabaseAdmin
      .from('projects_enriched')
      .select('application_id, patent_count, publication_count, clinical_trial_count')
      .in('application_id', appIds)

    const enrichedMap = new Map(
      (enrichedData || []).map(e => [e.application_id, e])
    )

    const enrichedResults = limitedResults.map(r => ({
      ...r,
      patent_count: enrichedMap.get(r.application_id)?.patent_count || 0,
      publication_count: enrichedMap.get(r.application_id)?.publication_count || 0,
      clinical_trial_count: enrichedMap.get(r.application_id)?.clinical_trial_count || 0
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
    case 'keyword_search':
      return keywordSearch(args as unknown as KeywordSearchParams, userAccess)
    case 'search_projects':
      return searchProjects(args as unknown as SearchProjectsParams, userAccess)
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
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}
