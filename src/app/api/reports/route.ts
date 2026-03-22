import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { generateTopicReport, generatePortfolioReport } from '@/lib/reports'
import type { ReportPersona } from '@/lib/reports/types'

// GET - List user's reports
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: reports, error } = await supabase
      .from('user_reports')
      .select('id, title, report_type, topic, status, project_count, data_limited, persona, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching reports:', error)
      return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
    }

    return NextResponse.json({ reports: reports || [] })
  } catch (error) {
    console.error('Error in GET /api/reports:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Generate a new report
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { report_type, topic, data_limited, persona } = body
    const reportPersona: ReportPersona = persona === 'investor' ? 'investor' : 'researcher'

    if (!report_type) {
      return NextResponse.json({ error: 'report_type is required' }, { status: 400 })
    }

    if (report_type === 'topic' && !topic) {
      return NextResponse.json({ error: 'topic is required for topic reports' }, { status: 400 })
    }

    // Start report generation (runs async, returns immediately with report ID)
    let reportId: string

    if (report_type === 'topic') {
      reportId = await generateTopicReport(user.id, topic, data_limited ?? false, reportPersona)
    } else if (report_type === 'portfolio') {
      reportId = await generatePortfolioReport(user.id)
    } else {
      return NextResponse.json({ error: 'Invalid report_type' }, { status: 400 })
    }

    return NextResponse.json({
      message: 'Report generation started',
      report_id: reportId,
    })
  } catch (error) {
    console.error('Error in POST /api/reports:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
