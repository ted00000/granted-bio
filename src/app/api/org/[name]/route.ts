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
    const orgName = decodeURIComponent(name)

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const year = searchParams.get('year') || ''
    const status = searchParams.get('status') || '' // 'active' or 'completed'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    // Get accurate total count and all project numbers for this org
    const { data: allProjects, error: allError } = await supabaseAdmin
      .from('projects')
      .select('project_number, pi_names, total_cost, fiscal_year, org_state, org_city, org_type')
      .eq('org_name', orgName)

    if (allError) {
      console.error('Error fetching org projects:', allError)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
    }

    if (!allProjects || allProjects.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
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
        org_type,
        total_cost,
        fiscal_year,
        pi_names,
        primary_category,
        project_start,
        project_end
      `, { count: 'exact' })
      .eq('org_name', orgName)

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

    // Get filtered projects with pagination
    const { data: topProjects, error: topError, count: filteredCount } = await query
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1)

    if (topError) {
      console.error('Error fetching top projects:', topError)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
    }

    // No deduplication for paginated results - return as-is
    const projects = topProjects || []

    // Get available filter options from all projects
    const categories = new Set<string>()
    const years = new Set<number>()
    allDedupedProjects.forEach(p => {
      // We need to get categories from the full dataset
    })

    // Calculate counts per filter option from all projects for this org
    // We need to count based on filtered data (excluding the dimension being counted)

    // Build base query conditions excluding each filter dimension
    const buildFilteredQuery = (excludeDimension: 'category' | 'year' | 'status' | 'none') => {
      let q = supabaseAdmin
        .from('projects')
        .select('project_number, primary_category, fiscal_year, project_end')
        .eq('org_name', orgName)

      if (search) {
        q = q.or(`title.ilike.%${search}%,pi_names.ilike.%${search}%`)
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

    // Calculate counts per category (deduplicated by project_number)
    const categoryProjects = categoryData.data || []
    const categoryProjectMap = new Map<string, Set<string>>()
    for (const p of categoryProjects) {
      if (!p.project_number || !p.primary_category) continue
      if (!categoryProjectMap.has(p.primary_category)) {
        categoryProjectMap.set(p.primary_category, new Set())
      }
      categoryProjectMap.get(p.primary_category)!.add(p.project_number)
    }
    const byCategory: Record<string, number> = {}
    for (const [cat, projects] of categoryProjectMap) {
      byCategory[cat] = projects.size
    }

    // Calculate counts per year (deduplicated by project_number)
    const yearProjects = yearData.data || []
    const yearProjectMap = new Map<number, Set<string>>()
    for (const p of yearProjects) {
      if (!p.project_number || !p.fiscal_year) continue
      if (!yearProjectMap.has(p.fiscal_year)) {
        yearProjectMap.set(p.fiscal_year, new Set())
      }
      yearProjectMap.get(p.fiscal_year)!.add(p.project_number)
    }
    const byYear: Record<number, number> = {}
    for (const [yr, projects] of yearProjectMap) {
      byYear[yr] = projects.size
    }

    // Calculate counts per status (deduplicated by project_number)
    const statusProjects = statusData.data || []
    const today = new Date().toISOString().split('T')[0]
    const activeProjects = new Set<string>()
    const completedProjects = new Set<string>()
    for (const p of statusProjects) {
      if (!p.project_number) continue
      if (p.project_end && p.project_end >= today) {
        activeProjects.add(p.project_number)
      } else if (p.project_end && p.project_end < today) {
        completedProjects.add(p.project_number)
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
      },
    })
  } catch (error) {
    console.error('Error in org API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
