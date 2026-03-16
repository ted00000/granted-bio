import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface PatentDetails {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  patent_date: string | null
  patent_type: string | null
  assignees: string[]
  inventors: string[]
  cpc_codes: string[]
  cited_by_count: number
  linked_project: {
    project_number: string
    application_id: string
    title: string
    org_name: string
    total_cost: number | null
  } | null
}

// GET - Fetch patent details by patent ID
// Note: Currently returns local data only. External API enrichment pending.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const supabase = await createServerSupabaseClient()

    // Clean up patent ID - remove US prefix and non-numeric chars
    const cleanPatentId = patentId.replace(/^US/i, '').replace(/[^0-9]/g, '')

    // Check if we have this patent in our database
    const { data: localPatent } = await supabase
      .from('patents')
      .select('patent_id, patent_title, project_number')
      .eq('patent_id', cleanPatentId)
      .limit(1)
      .single()

    // If not in patents table, check if it exists in project_patents junction
    if (!localPatent) {
      const { data: linkedPatent } = await supabase
        .from('project_patents')
        .select('patent_id, project_number')
        .eq('patent_id', cleanPatentId)
        .limit(1)
        .single()

      if (!linkedPatent) {
        return NextResponse.json(
          { error: 'Patent not found in database' },
          { status: 404 }
        )
      }

      // Patent exists in linkage but no detail record - return basic info
      const result: PatentDetails = {
        patent_id: linkedPatent.patent_id,
        patent_title: null,
        patent_abstract: null,
        patent_date: null,
        patent_type: null,
        assignees: [],
        inventors: [],
        cpc_codes: [],
        cited_by_count: 0,
        linked_project: null
      }

      // Get linked project
      if (linkedPatent.project_number) {
        const { data: project } = await supabase
          .from('projects')
          .select('project_number, application_id, title, org_name, total_cost')
          .eq('project_number', linkedPatent.project_number)
          .limit(1)
          .single()
        result.linked_project = project
      }

      return NextResponse.json({ patent: result, source: 'linked_only' })
    }

    const result: PatentDetails = {
      patent_id: localPatent.patent_id,
      patent_title: localPatent.patent_title,
      patent_abstract: null,
      patent_date: null,
      patent_type: null,
      assignees: [],
      inventors: [],
      cpc_codes: [],
      cited_by_count: 0,
      linked_project: null
    }

    // Get linked project if available
    if (localPatent.project_number) {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, application_id, title, org_name, total_cost')
        .eq('project_number', localPatent.project_number)
        .limit(1)
        .single()
      result.linked_project = project
    }

    return NextResponse.json({ patent: result, source: 'local' })
  } catch (error) {
    console.error('Error fetching patent:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
