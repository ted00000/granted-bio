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

interface USPTOPatentData {
  patentNumber: string
  patentTitle?: string
  abstract?: string
  grantDate?: string
  inventors?: Array<{ nameLineOne: string }>
  assignees?: Array<{ orgName: string }>
}

// Fetch patent data from USPTO API
async function fetchUSPTOData(patentId: string): Promise<USPTOPatentData | null> {
  try {
    // USPTO PatentsView API - free, no auth required
    const response = await fetch(
      `https://api.patentsview.org/patents/query?q={"patent_number":"${patentId}"}&f=["patent_number","patent_title","patent_abstract","patent_date","inventor_first_name","inventor_last_name","assignee_organization"]`,
      {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 86400 } // Cache for 24 hours
      }
    )

    if (!response.ok) {
      console.error('USPTO API error:', response.status)
      return null
    }

    const data = await response.json()

    if (!data.patents || data.patents.length === 0) {
      return null
    }

    const patent = data.patents[0]
    return {
      patentNumber: patent.patent_number,
      patentTitle: patent.patent_title,
      abstract: patent.patent_abstract,
      grantDate: patent.patent_date,
      inventors: patent.inventors?.map((inv: any) => ({
        nameLineOne: `${inv.inventor_first_name || ''} ${inv.inventor_last_name || ''}`.trim()
      })) || [],
      assignees: patent.assignees?.map((a: any) => ({
        orgName: a.assignee_organization
      })).filter((a: any) => a.orgName) || []
    }
  } catch (error) {
    console.error('Error fetching USPTO data:', error)
    return null
  }
}

// GET - Fetch patent details by patent ID
// Augments local data with USPTO API when available
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> }
) {
  try {
    const { patentId } = await params
    const supabase = await createServerSupabaseClient()

    // Clean up patent ID - remove US prefix and non-numeric chars
    const cleanPatentId = patentId.replace(/^US/i, '').replace(/[^0-9]/g, '')

    // Check if we have this patent in our database (use maybeSingle to avoid errors)
    const { data: localPatent } = await supabase
      .from('patents')
      .select('patent_id, patent_title')
      .eq('patent_id', cleanPatentId)
      .maybeSingle()

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

    // Fetch USPTO data to augment our local data
    const usptoData = await fetchUSPTOData(cleanPatentId)

    // Build result - prefer local data, augment with USPTO
    const result: PatentDetails = {
      patent_id: cleanPatentId,
      patent_title: localPatent?.patent_title || usptoData?.patentTitle || null,
      patent_abstract: usptoData?.abstract || null,
      patent_date: usptoData?.grantDate || null,
      patent_type: null,
      assignees: usptoData?.assignees?.map(a => a.orgName) || [],
      inventors: usptoData?.inventors?.map(i => i.nameLineOne) || [],
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
        .maybeSingle()
      result.linked_project = project
    }

    // Determine source
    const source = usptoData ? 'uspto' : (localPatent ? 'local' : 'linked_only')

    return NextResponse.json({ patent: result, source })
  } catch (error) {
    console.error('Error fetching patent:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
