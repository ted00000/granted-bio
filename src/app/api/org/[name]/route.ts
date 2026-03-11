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

    // Get accurate total count and all project numbers for this org
    const { data: allProjects, error: allError } = await supabaseAdmin
      .from('projects')
      .select('project_number, pi_names, total_cost, fiscal_year')
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
        org_type,
        total_cost,
        fiscal_year,
        pi_names,
        primary_category,
        project_start,
        project_end
      `)
      .eq('org_name', orgName)
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .limit(100)

    if (topError) {
      console.error('Error fetching top projects:', topError)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
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
      org_name: orgName,
      org_state: dedupedProjects[0]?.org_state,
      org_city: dedupedProjects[0]?.org_city,
      org_type: dedupedProjects[0]?.org_type,
      stats: {
        project_count: allDedupedProjects.length,
        total_funding: totalFunding,
        patent_count: patentsResult.count || 0,
        publication_count: pubsResult.count || 0,
        clinical_trial_count: trialsResult.count || 0,
        pi_count: uniquePIs.size,
      },
      projects: dedupedProjects,
      has_more: allDedupedProjects.length > dedupedProjects.length,
    })
  } catch (error) {
    console.error('Error in org API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
