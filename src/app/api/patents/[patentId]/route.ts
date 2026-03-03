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

// Helper to build local-only patent response
async function buildLocalPatentResponse(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  localPatent: { patent_id: string; patent_title: string | null; project_number: string | null }
): Promise<PatentDetails> {
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

  return result
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

    // First check if we have this patent in our database
    const { data: localPatent } = await supabase
      .from('patents')
      .select('patent_id, patent_title, project_number')
      .eq('patent_id', cleanPatentId)
      .limit(1)
      .single()

    // Check for USPTO API key - if not available, return local data only
    const apiKey = process.env.USPTO_API_KEY
    if (!apiKey) {
      if (localPatent) {
        const result = await buildLocalPatentResponse(supabase, localPatent)
        return NextResponse.json({ patent: result, source: 'local' })
      }
      return NextResponse.json(
        { error: 'Patent not found in database' },
        { status: 404 }
      )
    }

    const query = encodeURIComponent(JSON.stringify({ patent_id: cleanPatentId }))
    const fields = encodeURIComponent(JSON.stringify([
      'patent_id',
      'patent_title',
      'patent_abstract',
      'patent_date',
      'patent_type',
      'assignees.assignee_organization',
      'inventors.inventor_name_first',
      'inventors.inventor_name_last',
      'cpcs.cpc_group_id'
    ]))

    const url = `https://search.patentsview.org/api/v1/patent/?q=${query}&f=${fields}`

    const response = await fetch(url, {
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json'
      },
      next: { revalidate: 86400 } // Cache for 24 hours
    })

    if (!response.ok) {
      // If USPTO fails but we have local data, return what we have
      if (localPatent) {
        const result = await buildLocalPatentResponse(supabase, localPatent)
        return NextResponse.json({ patent: result, source: 'local' })
      }
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'USPTO API rate limit exceeded. Try again later.' },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { error: `USPTO API error: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!data.patents || data.patents.length === 0) {
      return NextResponse.json(
        { error: 'Patent not found' },
        { status: 404 }
      )
    }

    const patent = data.patents[0]

    // Get citation count (separate query)
    let citedByCount = 0
    try {
      const citQuery = encodeURIComponent(JSON.stringify({
        _and: [{ cited_patent_id: cleanPatentId }]
      }))
      const citUrl = `https://search.patentsview.org/api/v1/patent/?q=${citQuery}&o=${encodeURIComponent('{"size":0}')}`
      const citResponse = await fetch(citUrl, {
        headers: { 'X-Api-Key': apiKey },
        next: { revalidate: 86400 }
      })
      if (citResponse.ok) {
        const citData = await citResponse.json()
        citedByCount = citData.total_hits || 0
      }
    } catch {
      // Citation count is optional
    }

    const result: PatentDetails = {
      patent_id: patent.patent_id,
      patent_title: patent.patent_title || null,
      patent_abstract: patent.patent_abstract || null,
      patent_date: patent.patent_date || null,
      patent_type: patent.patent_type || null,
      assignees: patent.assignees?.map((a: { assignee_organization: string }) => a.assignee_organization).filter(Boolean) || [],
      inventors: patent.inventors?.map((i: { inventor_name_first: string; inventor_name_last: string }) =>
        `${i.inventor_name_first} ${i.inventor_name_last}`.trim()
      ).filter(Boolean) || [],
      cpc_codes: patent.cpcs?.map((c: { cpc_group_id: string }) => c.cpc_group_id).filter(Boolean).slice(0, 10) || [],
      cited_by_count: citedByCount,
      linked_project: null
    }

    // Get linked project if available
    if (localPatent?.project_number) {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, application_id, title, org_name, total_cost')
        .eq('project_number', localPatent.project_number)
        .limit(1)
        .single()
      result.linked_project = project
    }

    return NextResponse.json({ patent: result, source: 'uspto' })
  } catch (error) {
    console.error('Error fetching patent:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
