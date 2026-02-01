// Tool definitions and implementations for Claude function calling

import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'
import type {
  SearchProjectsParams,
  GetCompanyProfileParams,
  GetPIProfileParams,
  FindSimilarParams,
  SearchPatentsParams,
  ProjectResult,
  CompanyProfile,
  PIProfile,
  PatentResult,
  UserAccess
} from './types'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'

// Tool definitions for Claude
export const AGENT_TOOLS: Tool[] = [
  {
    name: 'search_projects',
    description: 'Search NIH projects using semantic similarity and filters. Use this to find projects matching a research area, technology, or topic.',
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
              type: 'string',
              description: 'Two-letter US state code, e.g. CA, MA, NY'
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
  }
]

// Tool implementations
export async function searchProjects(
  params: SearchProjectsParams,
  userAccess: UserAccess
): Promise<{ results: ProjectResult[], total: number }> {
  const { query, filters, limit = 25 } = params
  const effectiveLimit = Math.min(limit, userAccess.resultsLimit)

  try {
    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(query)

    // Use the search_projects RPC function
    const { data, error } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: effectiveLimit,
      min_biotools_confidence: 0
    })

    if (error) {
      console.error('Vector search error:', error)
      throw error
    }

    let results = data as ProjectResult[]

    // Apply additional filters
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
      if (filters.is_sbir !== undefined) {
        // Check activity code for SBIR
        results = results.filter(p =>
          filters.is_sbir
            ? p.funding_mechanism?.includes('SBIR')
            : !p.funding_mechanism?.includes('SBIR')
        )
      }
      if (filters.is_sttr !== undefined) {
        results = results.filter(p =>
          filters.is_sttr
            ? p.funding_mechanism?.includes('STTR')
            : !p.funding_mechanism?.includes('STTR')
        )
      }
      if (filters.min_funding !== undefined) {
        results = results.filter(p => (p.total_cost || 0) >= filters.min_funding!)
      }
      if (filters.max_funding !== undefined) {
        results = results.filter(p => (p.total_cost || 0) <= filters.max_funding!)
      }
      if (filters.state) {
        results = results.filter(p => p.org_state === filters.state)
      }
    }

    return {
      results: results.slice(0, effectiveLimit),
      total: results.length
    }
  } catch (error) {
    console.error('Search projects error:', error)
    throw error
  }
}

export async function getCompanyProfile(
  params: GetCompanyProfileParams,
  userAccess: UserAccess
): Promise<CompanyProfile | null> {
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

    return {
      org_name: canonicalOrgName || org_name,
      total_funding: totalFunding,
      project_count: projects.length,
      patent_count: patentCount || 0,
      publication_count: pubCount || 0,
      clinical_trial_count: trialCount || 0,
      projects: projects.slice(0, userAccess.resultsLimit) as ProjectResult[],
      primary_categories: categories,
      fiscal_years: Array.from(fiscalYears).sort((a, b) => b - a),
      states: Array.from(states)
    }
  } catch (error) {
    console.error('Get company profile error:', error)
    throw error
  }
}

export async function getPIProfile(
  params: GetPIProfileParams,
  userAccess: UserAccess
): Promise<PIProfile | null> {
  const { pi_name } = params

  try {
    // Search for projects with this PI
    const { data: projects, error: projectsError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .ilike('pi_names', `%${pi_name}%`)
      .order('fiscal_year', { ascending: false })

    if (projectsError) throw projectsError

    if (!projects?.length) {
      return null
    }

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
      pi_name,
      organizations: organizations as string[],
      total_funding: totalFunding,
      project_count: projects.length,
      publication_count: pubCount || 0,
      projects: projects.slice(0, userAccess.resultsLimit) as ProjectResult[]
    }
  } catch (error) {
    console.error('Get PI profile error:', error)
    throw error
  }
}

export async function findSimilar(
  params: FindSimilarParams,
  userAccess: UserAccess
): Promise<ProjectResult[]> {
  const { project_id, limit = 10 } = params
  const effectiveLimit = Math.min(limit, userAccess.resultsLimit)

  try {
    // Get the source project's embedding
    const { data: sourceProject, error: sourceError } = await supabaseAdmin
      .from('projects')
      .select('project_embedding, title')
      .eq('application_id', project_id)
      .single()

    if (sourceError || !sourceProject?.project_embedding) {
      throw new Error('Project not found or has no embedding')
    }

    // Search for similar projects
    const { data, error } = await supabaseAdmin.rpc('search_projects', {
      query_embedding: sourceProject.project_embedding,
      match_threshold: 0.6,
      match_count: effectiveLimit + 1, // +1 to exclude self
      min_biotools_confidence: 0
    })

    if (error) throw error

    // Filter out the source project
    const results = (data as ProjectResult[]).filter(
      p => p.application_id !== project_id
    )

    return results.slice(0, effectiveLimit)
  } catch (error) {
    console.error('Find similar error:', error)
    throw error
  }
}

export async function searchPatents(
  params: SearchPatentsParams,
  userAccess: UserAccess
): Promise<PatentResult[]> {
  const { query, limit = 20 } = params
  const effectiveLimit = Math.min(limit, userAccess.resultsLimit)

  try {
    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(query)

    // Search patents using vector similarity
    const { data, error } = await supabaseAdmin.rpc('search_patents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: effectiveLimit
    })

    if (error) {
      // If RPC doesn't exist, fall back to text search
      console.warn('Patent vector search not available, falling back to text search')
      const { data: textResults, error: textError } = await supabaseAdmin
        .from('patents')
        .select('patent_id, patent_title, project_number')
        .ilike('patent_title', `%${query}%`)
        .limit(effectiveLimit)

      if (textError) throw textError
      return textResults as PatentResult[]
    }

    return data as PatentResult[]
  } catch (error) {
    console.error('Search patents error:', error)
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
      return searchProjects(args as unknown as SearchProjectsParams, userAccess)
    case 'get_company_profile':
      return getCompanyProfile(args as unknown as GetCompanyProfileParams, userAccess)
    case 'get_pi_profile':
      return getPIProfile(args as unknown as GetPIProfileParams, userAccess)
    case 'find_similar':
      return findSimilar(args as unknown as FindSimilarParams, userAccess)
    case 'search_patents':
      return searchPatents(args as unknown as SearchPatentsParams, userAccess)
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}
