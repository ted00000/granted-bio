import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { findRefreshCreditForReport, findRetryCreditForReport } from '@/lib/billing/credits'

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

// GET - Get a single report by ID
//
// Response also surfaces refresh/retry affordances so the report detail
// page renders the right buttons without extra roundtrips:
//   refreshAvailable: an unconsumed refresh credit is bound to this report
//   retryAvailable: a retry credit exists OR could be self-serve-granted
//     (completed within 14 days AND no prior retry on this original)
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

    // Retry availability — separate axis from refresh. Available when:
    //   - report is a topic report (not portfolio), AND
    //   - an unconsumed retry credit exists (failure auto-grant or
    //     prior self-serve grant), OR
    //   - report is COMPLETE within the last 14 days AND no prior retry
    //     credit exists for this original (eligible for self-serve grant
    //     on first feedback submission).
    let retryAvailable = false
    if (report.report_type === 'topic') {
      const existing = await findRetryCreditForReport(id, user.id)
      if (existing) {
        retryAvailable = true
      } else if (report.status === 'complete' && report.created_at) {
        const ageMs = Date.now() - new Date(report.created_at).getTime()
        retryAvailable = ageMs <= FOURTEEN_DAYS_MS
      }
    }

    return NextResponse.json({ report, refreshAvailable, retryAvailable })
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
