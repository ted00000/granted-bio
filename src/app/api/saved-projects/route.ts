import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - List saved projects for current user
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get saved projects with project details
    const { data, error } = await supabase
      .from('saved_projects')
      .select(`
        id,
        saved_at,
        project:projects (
          application_id,
          title,
          org_name,
          total_cost,
          project_end,
          primary_category,
          activity_code
        )
      `)
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })

    if (error) {
      console.error('Error fetching saved projects:', error)
      return NextResponse.json({ error: 'Failed to fetch saved projects' }, { status: 500 })
    }

    return NextResponse.json({ projects: data })
  } catch (error) {
    console.error('Error in GET /api/saved-projects:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Save a project
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { application_id } = await request.json()

    if (!application_id) {
      return NextResponse.json({ error: 'application_id is required' }, { status: 400 })
    }

    // Check if already saved
    const { data: existing } = await supabase
      .from('saved_projects')
      .select('id')
      .eq('user_id', user.id)
      .eq('application_id', application_id)
      .single()

    if (existing) {
      return NextResponse.json({ message: 'Already saved', id: existing.id })
    }

    // Save the project
    const { data, error } = await supabase
      .from('saved_projects')
      .insert({
        user_id: user.id,
        application_id
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error saving project:', error)
      return NextResponse.json({ error: 'Failed to save project' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Saved', id: data.id })
  } catch (error) {
    console.error('Error in POST /api/saved-projects:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Unsave a project
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const application_id = searchParams.get('application_id')

    if (!application_id) {
      return NextResponse.json({ error: 'application_id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('saved_projects')
      .delete()
      .eq('user_id', user.id)
      .eq('application_id', application_id)

    if (error) {
      console.error('Error unsaving project:', error)
      return NextResponse.json({ error: 'Failed to unsave project' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Unsaved' })
  } catch (error) {
    console.error('Error in DELETE /api/saved-projects:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
