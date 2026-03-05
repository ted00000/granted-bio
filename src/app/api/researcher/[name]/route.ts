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

    // Fetch all projects where pi_names contains this name
    // Use ilike for case-insensitive partial matching
    const { data: projects, error } = await supabaseAdmin
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
        project_end,
        patent_count,
        publication_count,
        clinical_trial_count
      `)
      .ilike('pi_names', `%${piName}%`)
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .limit(100)

    if (error) {
      console.error('Error fetching researcher projects:', error)
      return NextResponse.json({ error: 'Failed to fetch researcher data' }, { status: 500 })
    }

    if (!projects || projects.length === 0) {
      return NextResponse.json({ error: 'Researcher not found' }, { status: 404 })
    }

    // Deduplicate by project_number - keep most recent fiscal year
    const seenProjects = new Map<string, typeof projects[0]>()
    for (const project of projects) {
      const key = project.project_number || project.application_id
      const existing = seenProjects.get(key)
      if (!existing || (project.fiscal_year || 0) > (existing.fiscal_year || 0)) {
        seenProjects.set(key, project)
      }
    }
    const dedupedProjects = Array.from(seenProjects.values())

    // Calculate summary stats from deduplicated projects
    const totalFunding = dedupedProjects.reduce((sum, p) => sum + (p.total_cost || 0), 0)
    const totalPatents = dedupedProjects.reduce((sum, p) => sum + (p.patent_count || 0), 0)
    const totalPublications = dedupedProjects.reduce((sum, p) => sum + (p.publication_count || 0), 0)
    const totalTrials = dedupedProjects.reduce((sum, p) => sum + (p.clinical_trial_count || 0), 0)

    // Get unique organizations
    const uniqueOrgs = new Set<string>()
    dedupedProjects.forEach(p => {
      if (p.org_name) uniqueOrgs.add(p.org_name)
    })

    // Determine primary organization (most projects)
    const orgCounts = new Map<string, number>()
    dedupedProjects.forEach(p => {
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

    // Get state from most recent project
    const primaryState = dedupedProjects.find(p => p.org_name === primaryOrg)?.org_state

    return NextResponse.json({
      pi_name: piName,
      primary_org: primaryOrg,
      org_state: primaryState,
      stats: {
        project_count: dedupedProjects.length,
        total_funding: totalFunding,
        patent_count: totalPatents,
        publication_count: totalPublications,
        clinical_trial_count: totalTrials,
        org_count: uniqueOrgs.size,
      },
      projects: dedupedProjects,
    })
  } catch (error) {
    console.error('Error in researcher API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
