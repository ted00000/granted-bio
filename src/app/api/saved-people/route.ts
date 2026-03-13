import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

// GET - List saved people for current user
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get saved people
    const { data: savedPeople, error: savedError } = await supabase
      .from('saved_people')
      .select('id, person_name, person_type, saved_at')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })

    if (savedError) {
      console.error('Error fetching saved people:', savedError)
      return NextResponse.json({ error: 'Failed to fetch saved people' }, { status: 500 })
    }

    if (!savedPeople || savedPeople.length === 0) {
      return NextResponse.json({ people: [] })
    }

    // Get stats for each person (project count, total funding)
    const peopleWithStats = await Promise.all(
      savedPeople.map(async (sp) => {
        if (sp.person_type === 'researcher') {
          // Get researcher stats
          const { data: projects } = await supabaseAdmin
            .from('projects')
            .select('application_id, total_cost, org_name')
            .ilike('pi_names', `%${sp.person_name}%`)
            .limit(100)

          const projectCount = projects?.length || 0
          const totalFunding = projects?.reduce((sum, p) => sum + (p.total_cost || 0), 0) || 0
          const orgs = [...new Set(projects?.map(p => p.org_name).filter(Boolean))]

          return {
            id: sp.id,
            name: sp.person_name,
            type: sp.person_type,
            saved_at: sp.saved_at,
            stats: {
              projectCount,
              totalFunding,
              organizations: orgs.slice(0, 3)
            }
          }
        } else {
          // Get organization stats
          const { data: projects } = await supabaseAdmin
            .from('projects')
            .select('application_id, total_cost, pi_names')
            .eq('org_name', sp.person_name)
            .limit(100)

          const projectCount = projects?.length || 0
          const totalFunding = projects?.reduce((sum, p) => sum + (p.total_cost || 0), 0) || 0

          return {
            id: sp.id,
            name: sp.person_name,
            type: sp.person_type,
            saved_at: sp.saved_at,
            stats: {
              projectCount,
              totalFunding
            }
          }
        }
      })
    )

    return NextResponse.json({ people: peopleWithStats })
  } catch (error) {
    console.error('Error in GET /api/saved-people:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save a person
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { person_name, person_type = 'researcher' } = await request.json()

    if (!person_name) {
      return NextResponse.json({ error: 'person_name is required' }, { status: 400 })
    }

    // Check if already saved
    const { data: existing } = await supabase
      .from('saved_people')
      .select('id')
      .eq('user_id', user.id)
      .eq('person_name', person_name)
      .eq('person_type', person_type)
      .single()

    if (existing) {
      return NextResponse.json({ message: 'Already saved', id: existing.id })
    }

    // Save the person
    const { data, error } = await supabase
      .from('saved_people')
      .insert({
        user_id: user.id,
        person_name,
        person_type
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error saving person:', error)
      return NextResponse.json({ error: 'Failed to save person', details: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Saved', id: data.id })
  } catch (error) {
    console.error('Error in POST /api/saved-people:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Unsave a person
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const person_name = searchParams.get('person_name')
    const person_type = searchParams.get('person_type') || 'researcher'

    if (!person_name) {
      return NextResponse.json({ error: 'person_name is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('saved_people')
      .delete()
      .eq('user_id', user.id)
      .eq('person_name', person_name)
      .eq('person_type', person_type)

    if (error) {
      console.error('Error unsaving person:', error)
      return NextResponse.json({ error: 'Failed to unsave person' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Unsaved' })
  } catch (error) {
    console.error('Error in DELETE /api/saved-people:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
