import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - List saved trials for current user
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get saved trials
    const { data: savedTrials, error: savedError } = await supabase
      .from('saved_trials')
      .select('id, nct_id, saved_at')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })

    if (savedError) {
      console.error('Error fetching saved trials:', savedError)
      return NextResponse.json({ error: 'Failed to fetch saved trials' }, { status: 500 })
    }

    if (!savedTrials || savedTrials.length === 0) {
      return NextResponse.json({ trials: [] })
    }

    // Get trial details for all saved trials
    const nctIds = savedTrials.map(st => st.nct_id)
    const { data: trials, error: trialsError } = await supabase
      .from('clinical_studies')
      .select('nct_id, study_title, study_status, is_therapeutic_trial, is_diagnostic_trial, project_number')
      .in('nct_id', nctIds)

    if (trialsError) {
      console.error('Error fetching trial details:', trialsError)
      return NextResponse.json({ error: 'Failed to fetch trial details' }, { status: 500 })
    }

    // Create a map for quick lookup
    const trialMap = new Map(trials?.map(t => [t.nct_id, t]) || [])

    // Combine saved trials with trial details
    const result = savedTrials.map(st => ({
      id: st.id,
      saved_at: st.saved_at,
      trial: trialMap.get(st.nct_id) || null
    })).filter(st => st.trial !== null)

    return NextResponse.json({ trials: result })
  } catch (error) {
    console.error('Error in GET /api/saved-trials:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save a trial
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { nct_id } = await request.json()

    if (!nct_id) {
      return NextResponse.json({ error: 'nct_id is required' }, { status: 400 })
    }

    // Check if already saved
    const { data: existing } = await supabase
      .from('saved_trials')
      .select('id')
      .eq('user_id', user.id)
      .eq('nct_id', nct_id)
      .single()

    if (existing) {
      return NextResponse.json({ message: 'Already saved', id: existing.id })
    }

    // Save the trial
    const { data, error } = await supabase
      .from('saved_trials')
      .insert({
        user_id: user.id,
        nct_id
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error saving trial:', error)
      return NextResponse.json({ error: 'Failed to save trial', details: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Saved', id: data.id })
  } catch (error) {
    console.error('Error in POST /api/saved-trials:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Unsave a trial
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const nct_id = searchParams.get('nct_id')

    if (!nct_id) {
      return NextResponse.json({ error: 'nct_id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('saved_trials')
      .delete()
      .eq('user_id', user.id)
      .eq('nct_id', nct_id)

    if (error) {
      console.error('Error unsaving trial:', error)
      return NextResponse.json({ error: 'Failed to unsave trial' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Unsaved' })
  } catch (error) {
    console.error('Error in DELETE /api/saved-trials:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
