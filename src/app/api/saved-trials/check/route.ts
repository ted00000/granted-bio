import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// GET - Check if a trial is saved
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    // Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ saved: false })
    }

    const { searchParams } = new URL(request.url)
    const nct_id = searchParams.get('nct_id')

    if (!nct_id) {
      return NextResponse.json({ error: 'nct_id is required' }, { status: 400 })
    }

    const { data } = await supabase
      .from('saved_trials')
      .select('id')
      .eq('user_id', user.id)
      .eq('nct_id', nct_id)
      .single()

    return NextResponse.json({ saved: !!data })
  } catch (error) {
    console.error('Error in GET /api/saved-trials/check:', error)
    return NextResponse.json({ saved: false })
  }
}
