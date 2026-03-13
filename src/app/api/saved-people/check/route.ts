import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - Check if a person is saved
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ saved: false })
    }

    const { searchParams } = new URL(request.url)
    const person_name = searchParams.get('person_name')
    const person_type = searchParams.get('person_type') || 'researcher'

    if (!person_name) {
      return NextResponse.json({ error: 'person_name is required' }, { status: 400 })
    }

    const { data } = await supabase
      .from('saved_people')
      .select('id')
      .eq('user_id', user.id)
      .eq('person_name', person_name)
      .eq('person_type', person_type)
      .single()

    return NextResponse.json({ saved: !!data })
  } catch (error) {
    console.error('Error in GET /api/saved-people/check:', error)
    return NextResponse.json({ saved: false })
  }
}
