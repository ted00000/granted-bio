import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Extract core project number for deduplication.
 * NIH project numbers like "5R44MH136894-02" and "1R44MH136894-01" are the same project.
 * This strips the leading digit (support type) and suffix (budget period).
 * Example: "5R44MH136894-02" → "R44MH136894"
 */
function getCoreProjectNumber(projectNumber: string): string {
  if (!projectNumber) return ''
  // Normalize: trim whitespace and uppercase for consistent matching
  let core = projectNumber.trim().toUpperCase()
  // Remove leading digit (0-9) if present (support type indicator)
  core = core.replace(/^[0-9]/, '')
  // Remove suffix after hyphen (-01, -02, etc.) - budget period indicator
  core = core.replace(/-\d+$/, '')
  // Also handle alternative suffix formats like -S1, -A1
  core = core.replace(/-[A-Z]\d+$/, '')
  return core
}

interface RouteParams {
  params: Promise<{ name: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { name } = await params
    const orgName = decodeURIComponent(name)

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const year = searchParams.get('year') || ''
    const status = searchParams.get('status') || '' // 'active' or 'completed'
    const hasPatents = searchParams.get('hasPatents') === 'true'
    const hasPubs = searchParams.get('hasPubs') === 'true'
    const hasTrials = searchParams.get('hasTrials') === 'true'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = (page - 1) * limit

    // Only include recent fiscal years (2024+)
    const MIN_FISCAL_YEAR = 2024

    // Get accurate total count and all project numbers for this org
    const { data: allProjects, error: allError } = await supabaseAdmin
      .from('projects')
      .select('project_number, pi_names, total_cost, fiscal_year, org_state, org_city, org_type, primary_category, project_end')
      .eq('org_name', orgName)
      .gte('fiscal_year', MIN_FISCAL_YEAR)

    if (allError) {
      console.error('Error fetching org projects:', allError)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
    }

    if (!allProjects || allProjects.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Deduplicate all projects by CORE project number for accurate counts
    // This ensures "5R44MH136894-02" and "1R44MH136894-01" are treated as same project
    const allSeenProjects = new Map<string, typeof allProjects[0]>()
    for (const project of allProjects) {
      const coreKey = getCoreProjectNumber(project.project_number || '')
      if (!coreKey) continue
      const existing = allSeenProjects.get(coreKey)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        allSeenProjects.set(coreKey, project)
      }
    }
    const allDedupedProjects = Array.from(allSeenProjects.values())
    // Keep actual project_numbers for linked table queries (they use full project_number)
    const allProjectNumbers = allDedupedProjects.map(p => p.project_number).filter(k => k) as string[]

    // Calculate accurate stats from ALL projects
    const totalFunding = allDedupedProjects.reduce((sum, p) => sum + (p.total_cost || 0), 0)

    // Get unique PIs from ALL projects
    const uniquePIs = new Set<string>()
    allDedupedProjects.forEach(p => {
      if (p.pi_names) {
        p.pi_names.split(';').forEach((name: string) => {
          const trimmed = name.trim()
          if (trimmed) uniquePIs.add(trimmed)
        })
      }
    })

    // Query linked tables for accurate counts AND project numbers that have each type (in parallel)
    const [patentsResult, pubsResult, trialsResult, patentProjects, pubProjects, trialProjects] = await Promise.all([
      supabaseAdmin
        .from('project_patents')
        .select('project_number', { count: 'exact', head: true })
        .in('project_number', allProjectNumbers),
      supabaseAdmin
        .from('project_publications')
        .select('project_number', { count: 'exact', head: true })
        .in('project_number', allProjectNumbers),
      supabaseAdmin
        .from('clinical_studies')
        .select('project_number', { count: 'exact', head: true })
        .in('project_number', allProjectNumbers),
      // Get project numbers that have patents
      supabaseAdmin
        .from('project_patents')
        .select('project_number')
        .in('project_number', allProjectNumbers),
      // Get project numbers that have publications
      supabaseAdmin
        .from('project_publications')
        .select('project_number')
        .in('project_number', allProjectNumbers),
      // Get project numbers that have trials
      supabaseAdmin
        .from('clinical_studies')
        .select('project_number')
        .in('project_number', allProjectNumbers),
    ])

    // Build sets of project numbers with patents/pubs/trials
    const projectsWithPatents = new Set((patentProjects.data || []).map(p => p.project_number))
    const projectsWithPubs = new Set((pubProjects.data || []).map(p => p.project_number))
    const projectsWithTrials = new Set((trialProjects.data || []).map(p => p.project_number))

    // Count deduplicated projects with each type
    let patentsCount = 0
    let pubsCount = 0
    let trialsCount = 0
    for (const p of allDedupedProjects) {
      if (p.project_number && projectsWithPatents.has(p.project_number)) patentsCount++
      if (p.project_number && projectsWithPubs.has(p.project_number)) pubsCount++
      if (p.project_number && projectsWithTrials.has(p.project_number)) trialsCount++
    }

    // Build set of project numbers to filter by (if quick filters are active)
    let filteredProjectNumbers = allProjectNumbers
    if (hasPatents) {
      filteredProjectNumbers = filteredProjectNumbers.filter(pn => projectsWithPatents.has(pn))
    }
    if (hasPubs) {
      filteredProjectNumbers = filteredProjectNumbers.filter(pn => projectsWithPubs.has(pn))
    }
    if (hasTrials) {
      filteredProjectNumbers = filteredProjectNumbers.filter(pn => projectsWithTrials.has(pn))
    }

    // Build filtered query for display projects
    let query = supabaseAdmin
      .from('projects')
      .select(`
        application_id,
        project_number,
        title,
        org_name,
        org_state,
        org_city,
        org_type,
        total_cost,
        fiscal_year,
        pi_names,
        primary_category,
        project_start,
        project_end
      `, { count: 'exact' })
      .eq('org_name', orgName)
      .gte('fiscal_year', MIN_FISCAL_YEAR)

    // Apply search filter
    if (search) {
      query = query.or(`title.ilike.%${search}%,pi_names.ilike.%${search}%`)
    }

    // Apply category filter
    if (category) {
      query = query.eq('primary_category', category)
    }

    // Apply year filter
    if (year) {
      query = query.eq('fiscal_year', parseInt(year, 10))
    }

    // Apply status filter
    if (status === 'active') {
      query = query.gte('project_end', new Date().toISOString().split('T')[0])
    } else if (status === 'completed') {
      query = query.lt('project_end', new Date().toISOString().split('T')[0])
    }

    // Apply quick filters (hasPatents, hasPubs, hasTrials)
    if (hasPatents || hasPubs || hasTrials) {
      query = query.in('project_number', filteredProjectNumbers)
    }

    // Get filtered projects with pagination
    const { data: topProjects, error: topError, count: filteredCount } = await query
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (topError) {
      console.error('Error fetching top projects:', topError)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
    }

    // Deduplicate display results by CORE project number (keep most recent fiscal year)
    const seenProjectNumbers = new Map<string, typeof topProjects[0]>()
    for (const project of topProjects || []) {
      const coreKey = getCoreProjectNumber(project.project_number || '')
      if (!coreKey) continue
      const existing = seenProjectNumbers.get(coreKey)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjectNumbers.set(coreKey, project)
      }
    }
    const projects = Array.from(seenProjectNumbers.values())

    // Calculate filter counts from DEDUPLICATED data (allDedupedProjects)
    // This ensures counts match the actual displayed project count
    const today = new Date().toISOString().split('T')[0]

    // Category counts from deduplicated projects
    const byCategory: Record<string, number> = {}
    for (const p of allDedupedProjects) {
      const cat = (p as { primary_category?: string }).primary_category
      if (cat) {
        byCategory[cat] = (byCategory[cat] || 0) + 1
      }
    }

    // Year counts from deduplicated projects (each project counted once, in its most recent year)
    const byYear: Record<number, number> = {}
    for (const p of allDedupedProjects) {
      if (p.fiscal_year) {
        byYear[p.fiscal_year] = (byYear[p.fiscal_year] || 0) + 1
      }
    }

    // Status counts from deduplicated projects
    let activeCount = 0
    let completedCount = 0
    for (const p of allDedupedProjects) {
      const projectEnd = (p as { project_end?: string }).project_end
      if (projectEnd && projectEnd >= today) {
        activeCount++
      } else if (projectEnd && projectEnd < today) {
        completedCount++
      }
    }
    const byStatus = {
      active: activeCount,
      completed: completedCount,
    }

    // Calculate total pages
    const totalFiltered = filteredCount || 0
    const totalPages = Math.ceil(totalFiltered / limit)

    return NextResponse.json({
      org_name: orgName,
      org_state: projects[0]?.org_state || allDedupedProjects[0]?.org_state,
      org_city: projects[0]?.org_city,
      org_type: projects[0]?.org_type,
      stats: {
        project_count: allDedupedProjects.length,
        total_funding: totalFunding,
        patent_count: patentsResult.count || 0,
        publication_count: pubsResult.count || 0,
        clinical_trial_count: trialsResult.count || 0,
        pi_count: uniquePIs.size,
      },
      projects,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      filters: {
        byCategory,
        byYear,
        byStatus,
        byQuickFilter: {
          hasPatents: patentsCount,
          hasPubs: pubsCount,
          hasTrials: trialsCount,
        },
      },
    })
  } catch (error) {
    console.error('Error in org API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
