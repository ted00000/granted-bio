import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

interface PublicationDetails {
  pmid: string
  pub_title: string | null
  journal_title: string | null
  journal_abbr: string | null
  pub_year: number | null
  pub_date: string | null
  author_list: string | null
  affiliation: string | null
  pmc_id: string | null
  linked_project: {
    project_number: string
    application_id: string
    title: string
    org_name: string
    total_cost: number | null
  } | null
}

// GET - Fetch publication details by PMID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pmid: string }> }
) {
  try {
    const { pmid } = await params
    const supabase = await createServerSupabaseClient()

    // Clean up PMID - remove any non-numeric chars
    const cleanPmid = pmid.replace(/[^0-9]/g, '')

    // Check if we have this publication in our database
    const { data: localPub } = await supabase
      .from('publications')
      .select('pmid, pub_title, journal_title, journal_abbr, pub_year, pub_date, author_list, affiliation, pmc_id')
      .eq('pmid', cleanPmid)
      .limit(1)
      .single()

    // Get project link from junction table
    const { data: pubLink } = await supabase
      .from('project_publications')
      .select('project_number')
      .eq('pmid', cleanPmid)
      .limit(1)
      .single()

    // If not in publications table AND not in junction table, return 404
    if (!localPub && !pubLink) {
      return NextResponse.json(
        { error: 'Publication not found in database' },
        { status: 404 }
      )
    }

    // Build result
    const result: PublicationDetails = {
      pmid: cleanPmid,
      pub_title: localPub?.pub_title || null,
      journal_title: localPub?.journal_title || null,
      journal_abbr: localPub?.journal_abbr || null,
      pub_year: localPub?.pub_year || null,
      pub_date: localPub?.pub_date || null,
      author_list: localPub?.author_list || null,
      affiliation: localPub?.affiliation || null,
      pmc_id: localPub?.pmc_id || null,
      linked_project: null
    }

    // Get linked project if we have a project_number from junction table
    if (pubLink?.project_number) {
      const { data: project } = await supabase
        .from('projects')
        .select('project_number, application_id, title, org_name, total_cost')
        .eq('project_number', pubLink.project_number)
        .limit(1)
        .single()
      result.linked_project = project
    }

    // Determine source: if we have publication details, it's 'local', otherwise 'linked_only'
    const source = localPub ? 'local' : 'linked_only'

    return NextResponse.json({ publication: result, source })
  } catch (error) {
    console.error('Error fetching publication:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
