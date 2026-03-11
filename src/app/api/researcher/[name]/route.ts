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

    // Now fetch top 100 projects for display
    const { data: topProjects, error: topError } = await supabaseAdmin
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
      `)
      .ilike('pi_names', `%${piName}%`)
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .limit(100)

    if (topError) {
      console.error('Error fetching top projects:', topError)
      return NextResponse.json({ error: 'Failed to fetch researcher data' }, { status: 500 })
    }

    // Deduplicate display projects
    const seenProjects = new Map<string, typeof topProjects[0]>()
    for (const project of topProjects || []) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
    const dedupedProjects = Array.from(seenProjects.values())

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
      projects: dedupedProjects,
      has_more: allDedupedProjects.length > dedupedProjects.length,
    })
  } catch (error) {
    console.error('Error in researcher API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
