import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { findRefreshCreditForReport } from '@/lib/billing/credits'

// GET - Get a single report by ID
//
// In addition to the report row, the response includes `refreshAvailable`
// so the report detail page can render the "Refresh" button without a
// second roundtrip.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: report, error } = await supabase
      .from('user_reports')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 })
      }
      console.error('Error fetching report:', error)
      return NextResponse.json({ error: 'Failed to fetch report' }, { status: 500 })
    }

    // Refresh entitlement check only applies to completed topic reports.
    // Failed and in-progress reports can't be refreshed; portfolio reports
    // aren't part of the credit model.
    let refreshAvailable = false
    if (report.status === 'complete' && report.report_type === 'topic') {
      const credit = await findRefreshCreditForReport(id, user.id)
      refreshAvailable = credit !== null
    }

    return NextResponse.json({ report, refreshAvailable })
  } catch (error) {
    console.error('Error in GET /api/reports/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a report
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // First verify the report belongs to the user
    const { data: existing, error: fetchError } = await supabase
      .from('user_reports')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('user_reports')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting report:', error)
      return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Report deleted' })
  } catch (error) {
    console.error('Error in DELETE /api/reports/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
