import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    // Fetch the project
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('*')
      .or(`id.eq.${id},project_number.eq.${id},application_id.eq.${id}`)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Fetch the abstract
    const { data: abstract } = await supabaseAdmin
      .from('abstracts')
      .select('abstract_text')
      .eq('application_id', project.application_id)
      .single()

    // Fetch publications for this project
    const { data: pubLinks } = await supabaseAdmin
      .from('project_publications')
      .select('pmid')
      .eq('project_number', project.project_number)

    let publications: any[] = []
    if (pubLinks && pubLinks.length > 0) {
      const pmids = pubLinks.map((l) => l.pmid)
      const { data: pubs } = await supabaseAdmin
        .from('publications')
        .select('*')
        .in('pmid', pmids)
        .order('pub_year', { ascending: false })
        .limit(50)

      publications = pubs || []
    }

    // Fetch patents for this project
    const { data: patents } = await supabaseAdmin
      .from('patents')
      .select('*')
      .eq('project_number', project.project_number)
      .limit(50)

    // Fetch clinical studies for this project
    const { data: clinicalStudies } = await supabaseAdmin
      .from('clinical_studies')
      .select('*')
      .eq('project_number', project.project_number)
      .limit(50)

    // Parse biotools_signals if it's a string
    let biotoolsSignals = project.biotools_signals
    if (typeof biotoolsSignals === 'string') {
      try {
        biotoolsSignals = JSON.parse(biotoolsSignals)
      } catch {
        biotoolsSignals = []
      }
    }

    return NextResponse.json({
      project: {
        ...project,
        biotools_signals: biotoolsSignals,
      },
      abstract: abstract?.abstract_text || null,
      publications: publications || [],
      patents: patents || [],
      clinicalStudies: clinicalStudies || [],
      stats: {
        publicationCount: publications?.length || 0,
        patentCount: patents?.length || 0,
        clinicalStudyCount: clinicalStudies?.length || 0,
        methodsJournalCount: publications?.filter((p) => p.is_methods_journal).length || 0,
        devicePatentCount: patents?.filter((p) => p.is_device_patent).length || 0,
      },
    })
  } catch (error) {
    console.error('Company detail error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch company details', details: String(error) },
      { status: 500 }
    )
  }
}
