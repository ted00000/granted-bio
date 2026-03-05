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

    // Fetch all projects for this organization
    const { data: projects, error } = await supabaseAdmin
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
        project_end,
        patent_count,
        publication_count,
        clinical_trial_count
      `)
      .eq('org_name', orgName)
      .order('fiscal_year', { ascending: false })
      .order('total_cost', { ascending: false, nullsFirst: false })
      .limit(100)

    if (error) {
      console.error('Error fetching org projects:', error)
      return NextResponse.json({ error: 'Failed to fetch organization data' }, { status: 500 })
    }

    if (!projects || projects.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
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

    // Get unique PIs
    const uniquePIs = new Set<string>()
    dedupedProjects.forEach(p => {
      if (p.pi_names) {
        p.pi_names.split(';').forEach((name: string) => {
          const trimmed = name.trim()
          if (trimmed) uniquePIs.add(trimmed)
        })
      }
    })

    return NextResponse.json({
      org_name: orgName,
      org_state: dedupedProjects[0]?.org_state,
      org_city: dedupedProjects[0]?.org_city,
      org_type: dedupedProjects[0]?.org_type,
      stats: {
        project_count: dedupedProjects.length,
        total_funding: totalFunding,
        patent_count: totalPatents,
        publication_count: totalPublications,
        clinical_trial_count: totalTrials,
        pi_count: uniquePIs.size,
      },
      projects: dedupedProjects,
    })
  } catch (error) {
    console.error('Error in org API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
