import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    // Get all projects for this researcher (for accurate stats)
    const { data: allProjects, error: allError } = await supabaseAdmin
      .from('projects')
      .select('project_number, org_name, org_state, total_cost, fiscal_year')
      .ilike('pi_names', `%${piName}%`)

    if (allError) {
      console.error('Error fetching researcher projects:', allError)
      return NextResponse.json({ error: 'Failed to fetch researcher data' }, { status: 500 })
    }

    if (!allProjects || allProjects.length === 0) {
      return NextResponse.json({ error: 'Researcher not found' }, { status: 404 })
    }

    // Deduplicate all projects by project_number for accurate counts
    const allSeenProjects = new Map<string, typeof allProjects[0]>()
    for (const project of allProjects) {
      const key = project.project_number || ''
      if (!key) continue
      const existing = allSeenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        allSeenProjects.set(key, project)
      }
    }
    const allDedupedProjects = Array.from(allSeenProjects.values())
    const allProjectNumbers = Array.from(allSeenProjects.keys()).filter(k => k)

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

    // No deduplication for paginated results - return as-is
    const projects = topProjects || []

    // Fetch distinct categories and years for this researcher
    const [categoriesResult, yearsResult] = await Promise.all([
      supabaseAdmin
        .from('projects')
        .select('primary_category')
        .ilike('pi_names', `%${piName}%`)
        .not('primary_category', 'is', null),
      supabaseAdmin
        .from('projects')
        .select('fiscal_year')
        .ilike('pi_names', `%${piName}%`)
        .not('fiscal_year', 'is', null),
    ])

    const availableCategories = [...new Set((categoriesResult.data || []).map(p => p.primary_category))].filter(Boolean).sort()
    const availableYears = [...new Set((yearsResult.data || []).map(p => p.fiscal_year))].filter(Boolean).sort((a, b) => b - a)

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
        categories: availableCategories,
        years: availableYears,
      },
    })
  } catch (error) {
    console.error('Error in researcher API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
