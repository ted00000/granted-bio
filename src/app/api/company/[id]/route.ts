import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Extract core project number for finding related records.
 * NIH project numbers like "5R44MH136894-02" and "1R44MH136894-01" are the same project.
 * This strips the leading digit (support type) and suffix (budget period).
 * Example: "5R44MH136894-02" → "R44MH136894"
 */
function getCoreProjectNumber(projectNumber: string): string {
  if (!projectNumber) return ''
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
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    // Fetch the project - try project_number first (most common), then application_id
    // Don't try UUID match unless it looks like a UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

    let project = null
    let projectError = null

    if (isUUID) {
      const result = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('id', id)
        .single()
      project = result.data
      projectError = result.error
    }

    if (!project) {
      // Try project_number
      const result = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('project_number', id)
        .maybeSingle()
      project = result.data
      projectError = result.error
    }

    if (!project) {
      // Try application_id (numeric string)
      const result = await supabaseAdmin
        .from('projects')
        .select('*')
        .eq('application_id', id)
        .maybeSingle()
      project = result.data
      projectError = result.error
    }

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Get core project number for finding all related records
    const coreProjectNumber = getCoreProjectNumber(project.project_number || '')

    // Find all related project records (different fiscal years/suffixes have different project_numbers)
    // These linked tables may reference any variant of the project number
    let allProjectNumbers: string[] = [project.project_number]

    if (coreProjectNumber) {
      // Find other project records with the same core project number
      const { data: relatedProjects } = await supabaseAdmin
        .from('projects')
        .select('project_number')
        .ilike('project_number', `%${coreProjectNumber}%`)

      if (relatedProjects) {
        const uniqueNumbers = new Set(relatedProjects.map(p => p.project_number).filter(Boolean))
        allProjectNumbers = Array.from(uniqueNumbers) as string[]
      }
    }

    // Fetch the abstract (use limit(1) in case of duplicates)
    const { data: abstractRows } = await supabaseAdmin
      .from('abstracts')
      .select('abstract_text')
      .eq('application_id', project.application_id)
      .limit(1)
    const abstract = abstractRows?.[0]

    // Fetch publications for this project (using all related project numbers)
    const { data: pubLinks } = await supabaseAdmin
      .from('project_publications')
      .select('pmid')
      .in('project_number', allProjectNumbers)

    let publications: any[] = []
    if (pubLinks && pubLinks.length > 0) {
      const pmids = [...new Set(pubLinks.map((l) => l.pmid))]
      const { data: pubs } = await supabaseAdmin
        .from('publications')
        .select('*')
        .in('pmid', pmids)
        .order('pub_year', { ascending: false })
        .limit(50)

      publications = pubs || []
    }

    // Fetch patents for this project via junction table (using all related project numbers)
    const { data: patentLinks } = await supabaseAdmin
      .from('project_patents')
      .select('patent_id')
      .in('project_number', allProjectNumbers)

    let patents: any[] = []
    if (patentLinks && patentLinks.length > 0) {
      const patentIds = [...new Set(patentLinks.map((l) => l.patent_id))]
      const { data: patentData } = await supabaseAdmin
        .from('patents')
        .select('*')
        .in('patent_id', patentIds)
        .limit(50)

      patents = patentData || []
    }

    // Fetch clinical studies for this project (using all related project numbers)
    const { data: clinicalStudies } = await supabaseAdmin
      .from('clinical_studies')
      .select('*')
      .in('project_number', allProjectNumbers)
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
