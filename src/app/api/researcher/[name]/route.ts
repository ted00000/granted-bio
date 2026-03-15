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
    const piName = decodeURIComponent(name)

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const year = searchParams.get('year') || ''
    const status = searchParams.get('status') || '' // 'active' or 'completed'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    // Only include recent fiscal years (2024+)
    const MIN_FISCAL_YEAR = 2024

    // Get all projects for this researcher (for accurate stats)
    const { data: allProjects, error: allError } = await supabaseAdmin
      .from('projects')
      .select('project_number, org_name, org_state, total_cost, fiscal_year')
      .ilike('pi_names', `%${piName}%`)
      .gte('fiscal_year', MIN_FISCAL_YEAR)

    if (allError) {
      console.error('Error fetching researcher projects:', allError)
      return NextResponse.json({ error: 'Failed to fetch researcher data' }, { status: 500 })
    }

    if (!allProjects || allProjects.length === 0) {
      return NextResponse.json({ error: 'Researcher not found' }, { status: 404 })
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

    // Get unique organizations
    const uniqueOrgs = new Set<string>()
    allDedupedProjects.forEach(p => {
      if (p.org_name) uniqueOrgs.add(p.org_name)
    })

    // Determine primary organization (most projects)
    const orgCounts = new Map<string, number>()
    allDedupedProjects.forEach(p => {
      if (p.org_name) {
        orgCounts.set(p.org_name, (orgCounts.get(p.org_name) || 0) + 1)
      }
    })
    let primaryOrg = ''
    let maxCount = 0
    orgCounts.forEach((count, org) => {
      if (count > maxCount) {
        maxCount = count
        primaryOrg = org
      }
    })

    // Get state from most recent project at primary org
    const primaryState = allDedupedProjects.find(p => p.org_name === primaryOrg)?.org_state

    // Query linked tables for accurate counts (in parallel)
    const [patentsResult, pubsResult, trialsResult] = await Promise.all([
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
    ])

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
        total_cost,
        fiscal_year,
        pi_names,
        primary_category,
        project_start,
        project_end
      `, { count: 'exact' })
      .ilike('pi_names', `%${piName}%`)
      .gte('fiscal_year', MIN_FISCAL_YEAR)

    // Apply search filter
    if (search) {
      query = query.or(`title.ilike.%${search}%,org_name.ilike.%${search}%`)
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

    // Get filtered projects with pagination
    const { data: topProjects, error: topError, count: filteredCount } = await query
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (topError) {
      console.error('Error fetching top projects:', topError)
      return NextResponse.json({ error: 'Failed to fetch researcher data' }, { status: 500 })
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

    // Calculate counts per filter option for this researcher
    // Build base query conditions excluding each filter dimension
    const buildFilteredQuery = (excludeDimension: 'category' | 'year' | 'status' | 'none') => {
      let q = supabaseAdmin
        .from('projects')
        .select('project_number, primary_category, fiscal_year, project_end')
        .ilike('pi_names', `%${piName}%`)
        .gte('fiscal_year', MIN_FISCAL_YEAR)

      if (search) {
        q = q.or(`title.ilike.%${search}%,org_name.ilike.%${search}%`)
      }
      if (category && excludeDimension !== 'category') {
        q = q.eq('primary_category', category)
      }
      if (year && excludeDimension !== 'year') {
        q = q.eq('fiscal_year', parseInt(year, 10))
      }
      if (status === 'active' && excludeDimension !== 'status') {
        q = q.gte('project_end', new Date().toISOString().split('T')[0])
      } else if (status === 'completed' && excludeDimension !== 'status') {
        q = q.lt('project_end', new Date().toISOString().split('T')[0])
      }

      return q
    }

    // Fetch all filtered projects for counting (excluding respective dimensions)
    const [categoryData, yearData, statusData] = await Promise.all([
      buildFilteredQuery('category'),
      buildFilteredQuery('year'),
      buildFilteredQuery('status'),
    ])

    // Calculate counts per category (deduplicated by CORE project number)
    const categoryProjects = categoryData.data || []
    const categoryProjectMap = new Map<string, Set<string>>()
    for (const p of categoryProjects) {
      const coreKey = getCoreProjectNumber(p.project_number || '')
      if (!coreKey || !p.primary_category) continue
      if (!categoryProjectMap.has(p.primary_category)) {
        categoryProjectMap.set(p.primary_category, new Set())
      }
      categoryProjectMap.get(p.primary_category)!.add(coreKey)
    }
    const byCategory: Record<string, number> = {}
    for (const [cat, projects] of categoryProjectMap) {
      byCategory[cat] = projects.size
    }

    // Calculate counts per year (deduplicated by CORE project number)
    const yearProjects = yearData.data || []
    const yearProjectMap = new Map<number, Set<string>>()
    for (const p of yearProjects) {
      const coreKey = getCoreProjectNumber(p.project_number || '')
      if (!coreKey || !p.fiscal_year) continue
      if (!yearProjectMap.has(p.fiscal_year)) {
        yearProjectMap.set(p.fiscal_year, new Set())
      }
      yearProjectMap.get(p.fiscal_year)!.add(coreKey)
    }
    const byYear: Record<number, number> = {}
    for (const [yr, projects] of yearProjectMap) {
      byYear[yr] = projects.size
    }

    // Calculate counts per status (deduplicated by CORE project number)
    const statusProjects = statusData.data || []
    const today = new Date().toISOString().split('T')[0]
    const activeProjects = new Set<string>()
    const completedProjects = new Set<string>()
    for (const p of statusProjects) {
      const coreKey = getCoreProjectNumber(p.project_number || '')
      if (!coreKey) continue
      if (p.project_end && p.project_end >= today) {
        activeProjects.add(coreKey)
      } else if (p.project_end && p.project_end < today) {
        completedProjects.add(coreKey)
      }
    }
    const byStatus = {
      active: activeProjects.size,
      completed: completedProjects.size,
    }

    // Calculate total pages
    const totalFiltered = filteredCount || 0
    const totalPages = Math.ceil(totalFiltered / limit)

    return NextResponse.json({
      pi_name: piName,
      primary_org: primaryOrg,
      org_state: primaryState,
      stats: {
        project_count: allDedupedProjects.length,
        total_funding: totalFunding,
        patent_count: patentsResult.count || 0,
        publication_count: pubsResult.count || 0,
        clinical_trial_count: trialsResult.count || 0,
        org_count: uniqueOrgs.size,
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
      },
    })
  } catch (error) {
    console.error('Error in researcher API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
