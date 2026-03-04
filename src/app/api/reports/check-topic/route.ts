import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { checkProjectCount } from '@/lib/reports'

// GET - Check project count for a topic before generating report
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const topic = searchParams.get('topic')

    if (!topic) {
      return NextResponse.json({ error: 'topic parameter is required' }, { status: 400 })
    }

    const projectCount = await checkProjectCount(topic)

    return NextResponse.json({
      topic,
      project_count: projectCount,
      data_limited: projectCount < 5,
    })
  } catch (error) {
    console.error('Error in GET /api/reports/check-topic:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
