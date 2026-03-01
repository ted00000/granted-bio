import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - Check if a project is saved
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ saved: false })
    }

    const { searchParams } = new URL(request.url)
    const application_id = searchParams.get('application_id')

    if (!application_id) {
      return NextResponse.json({ error: 'application_id is required' }, { status: 400 })
    }

    const { data } = await supabase
      .from('saved_projects')
      .select('id')
      .eq('user_id', user.id)
      .eq('application_id', application_id)
      .single()

    return NextResponse.json({ saved: !!data })
  } catch (error) {
    console.error('Error in GET /api/saved-projects/check:', error)
    return NextResponse.json({ saved: false })
  }
}
