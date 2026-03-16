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

    // Check if we have this patent in our database (project_number no longer on patents table)
    const { data: localPatent, error: patentError } = await supabase
      .from('patents')
      .select('patent_id, patent_title')
      .eq('patent_id', cleanPatentId)
      .limit(1)
      .single()

    // Get project link from junction table
    const { data: patentLink } = await supabase
      .from('project_patents')
      .select('project_number')
      .eq('patent_id', cleanPatentId)
      .limit(1)
      .single()

    // If not in patents table AND not in junction table, return 404
    if (!localPatent && !patentLink) {
      return NextResponse.json(
        { error: 'Patent not found in database' },
        { status: 404 }
      )
    }

    // Build result
    const result: PatentDetails = {
      patent_id: cleanPatentId,
      patent_title: localPatent?.patent_title || null,
      patent_abstract: null,
      patent_date: null,
      patent_type: null,
      assignees: [],
      inventors: [],
      cpc_codes: [],
      cited_by_count: 0,
      linked_project: null
    }

    // Get linked project if we have a project_number from junction table
    if (patentLink?.project_number) {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, application_id, title, org_name, total_cost')
        .eq('project_number', patentLink.project_number)
        .limit(1)
        .single()
      result.linked_project = project
    }

    // Determine source: if we have patent details, it's 'local', otherwise 'linked_only'
    const source = localPatent ? 'local' : 'linked_only'

    return NextResponse.json({ patent: result, source })
  } catch (error) {
    console.error('Error fetching patent:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
