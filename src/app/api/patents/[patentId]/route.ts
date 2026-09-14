import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { expandProjectNumberVariants } from '@/lib/project-number-utils'

interface AssignmentHistoryEntry {
  conveyance: string | null
  recorded_date: string | null
  assignees: string[]
}

interface PatentDetails {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  patent_date: string | null
  patent_type: string | null
  patent_org: string | null  // Legacy assignee display (NIH-linked feed)
  assignees: string[]         // Originating applicants (ODP meta-data)
  inventors: string[]
  cpc_codes: string[]
  cited_by_count: number
  // ODP-hydrated fields (populated when api_last_updated is set)
  application_number: string | null
  patent_type_code: string | null
  patent_status: string | null
  examiner_name: string | null
  art_unit: string | null
  uspc_code: string | null
  current_assignees: string[]
  assignment_history: AssignmentHistoryEntry[]
  api_last_updated: string | null
  hydration_error: string | null
  linked_project: {
    project_number: string
    application_id: string
    title: string
    org_name: string
    total_cost: number | null
  } | null
}

// GET - Fetch patent details by patent ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const supabase = await createServerSupabaseClient()

    // Clean up patent ID - remove US prefix and non-numeric chars
    const cleanPatentId = patentId.replace(/^US/i, '').replace(/[^0-9]/g, '')

    // Fetch patent with all available fields (including ODP-hydrated
    // columns from migration 20260914; NULL for un-hydrated rows).
    // Cast through unknown because the generated Database types don't
    // yet include the ODP-enrichment columns until types are regenerated
    // post-migration; the select shape below is authoritative at
    // runtime.
    const { data: rawLocal } = await supabase
      .from('patents')
      .select(
        'patent_id, patent_title, abstract, patent_org, issue_date, patent_type, ' +
        'application_number, patent_type_code, patent_status, examiner_name, ' +
        'art_unit, uspc_code, assignees, inventors, cpc_codes, current_assignees, ' +
        'assignment_history, api_last_updated, hydration_error'
      )
      .eq('patent_id', cleanPatentId)
      .maybeSingle()
    interface LocalPatentRow {
      patent_title: string | null
      abstract: string | null
      patent_org: string | null
      issue_date: string | null
      patent_type: string | null
      application_number: string | null
      patent_type_code: string | null
      patent_status: string | null
      examiner_name: string | null
      art_unit: string | null
      uspc_code: string | null
      assignees: string[] | null
      inventors: string[] | null
      cpc_codes: string[] | null
      current_assignees: string[] | null
      assignment_history: AssignmentHistoryEntry[] | null
      api_last_updated: string | null
      hydration_error: string | null
    }
    const localPatent = (rawLocal as unknown) as LocalPatentRow | null

    // Get project link from junction table
    const { data: patentLink } = await supabase
      .from('project_patents')
      .select('project_number')
      .eq('patent_id', cleanPatentId)
      .maybeSingle()

    // If not in patents table AND not in junction table, return 404
    if (!localPatent && !patentLink) {
      return NextResponse.json(
        { error: 'Patent not found in database' },
        { status: 404 }
      )
    }

    // Build result from local data. Prefer ODP-hydrated arrays when
    // present; fall back to the legacy patent_org for the assignee
    // display so un-hydrated rows still render something reasonable.
    const hydratedAssignees = localPatent?.assignees ?? []
    const legacyAssignees = localPatent?.patent_org ? [localPatent.patent_org] : []
    const result: PatentDetails = {
      patent_id: cleanPatentId,
      patent_title: localPatent?.patent_title || null,
      patent_abstract: localPatent?.abstract || null,
      patent_date: localPatent?.issue_date || null,
      patent_type: localPatent?.patent_type || null,
      patent_org: localPatent?.patent_org || null,
      assignees: hydratedAssignees.length > 0 ? hydratedAssignees : legacyAssignees,
      inventors: localPatent?.inventors ?? [],
      cpc_codes: localPatent?.cpc_codes ?? [],
      cited_by_count: 0,
      application_number: localPatent?.application_number ?? null,
      patent_type_code: localPatent?.patent_type_code ?? null,
      patent_status: localPatent?.patent_status ?? null,
      examiner_name: localPatent?.examiner_name ?? null,
      art_unit: localPatent?.art_unit ?? null,
      uspc_code: localPatent?.uspc_code ?? null,
      current_assignees: localPatent?.current_assignees ?? [],
      assignment_history: localPatent?.assignment_history ?? [],
      api_last_updated: localPatent?.api_last_updated ?? null,
      hydration_error: localPatent?.hydration_error ?? null,
      linked_project: null
    }

    // Get linked project if we have a project_number from junction table
    if (patentLink?.project_number) {
      // Linkage stores core form; projects table is mixed. Use .in()
      // with variant expansion so we match either form.
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, application_id, title, org_name, total_cost')
        .in('project_number', expandProjectNumberVariants([patentLink.project_number]))
        .limit(1)
        .maybeSingle()
      result.linked_project = project
    }

    // Source is 'local' if we have patent details, 'linked_only' otherwise
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
