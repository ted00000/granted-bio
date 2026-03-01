import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - Fetch trial details by NCT ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ nctId: string }> }
) {
  try {
    const { nctId } = await params
    const supabase = await createServerSupabaseClient()

    // Fetch trial with all enriched data
    const { data: trial, error } = await supabase
      .from('clinical_studies')
      .select(`
        nct_id,
        project_number,
        study_title,
        study_status,
        is_therapeutic_trial,
        is_diagnostic_trial,
        phase,
        conditions,
        interventions,
        enrollment_count,
        lead_sponsor,
        start_date,
        completion_date,
        eligibility_criteria,
        study_type,
        brief_summary,
        api_last_updated
      `)
      .eq('nct_id', nctId)
      .limit(1)
      .single()

    if (error || !trial) {
      return NextResponse.json(
        { error: 'Trial not found' },
        { status: 404 }
      )
    }

    // Fetch linked project info if available
    let project = null
    if (trial.project_number) {
      const { data: projectData } = await supabase
        .from('projects')
        .select('application_id, title, org_name, total_cost, pi_names')
        .eq('project_number', trial.project_number)
        .limit(1)
        .single()
      project = projectData
    }

    return NextResponse.json({
      trial,
      project
    })
  } catch (error) {
    console.error('Error fetching trial:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
