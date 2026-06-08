// POST /api/reports/[id]/refresh
//
// Consumes the refresh entitlement bound to a report and regenerates the
// same report against current NIH data, using the original interpretation
// so the topic + scope match what the buyer originally chose.
//
// The original report is preserved (not overwritten). The new report becomes
// the consumed_for_report_id of the refresh credit and shows up as a
// separate row in the user's reports list. This lets the buyer compare
// before/after if they want.
//
// Authorization: the report must belong to the requesting user, and the
// refresh credit must exist, be unconsumed, and be unexpired. No new
// refresh entitlement is granted on the regenerated report — refresh is
// a one-time-per-purchase benefit, not a perpetual one.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateTopicReport } from '@/lib/reports'
import { findRefreshCreditForReport, markCreditConsumed } from '@/lib/billing/credits'
import type { ReportPersona } from '@/lib/reports/types'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: originalReportId } = await params
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Load the original report — must exist, must belong to the user, must
    // be a completed topic report. Refreshing a portfolio or failed report
    // is out of scope for Phase 3a.
    const { data: originalReport, error: fetchError } = await supabaseAdmin
      .from('user_reports')
      .select('id, user_id, report_type, topic, persona, status, data_limited, interpretation')
      .eq('id', originalReportId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !originalReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    if (originalReport.report_type !== 'topic') {
      return NextResponse.json(
        { error: 'Refresh is only supported for topic reports' },
        { status: 400 }
      )
    }

    if (originalReport.status !== 'complete') {
      return NextResponse.json(
        { error: 'Refresh requires the original report to be complete' },
        { status: 400 }
      )
    }

    if (!originalReport.topic) {
      return NextResponse.json(
        { error: 'Original report has no topic; cannot refresh' },
        { status: 400 }
      )
    }

    // Check refresh entitlement
    const refreshCredit = await findRefreshCreditForReport(originalReportId, user.id)
    if (!refreshCredit) {
      return NextResponse.json(
        { error: 'No refresh entitlement available for this report' },
        { status: 403 }
      )
    }

    // Generate the new report using the same topic + interpretation + persona.
    // injectedInterpretation comes from the original report row when present;
    // historical pre-picker reports fall back to topic-only generation.
    const persona: ReportPersona =
      originalReport.persona === 'investor' ? 'investor' : 'researcher'

    const injectedInterpretation =
      originalReport.interpretation &&
      typeof originalReport.interpretation === 'object' &&
      typeof (originalReport.interpretation as { semanticQuery?: unknown }).semanticQuery === 'string' &&
      typeof (originalReport.interpretation as { keywordQuery?: unknown }).keywordQuery === 'string' &&
      typeof (originalReport.interpretation as { label?: unknown }).label === 'string'
        ? (originalReport.interpretation as {
            semanticQuery: string
            keywordQuery: string
            label: string
          })
        : undefined

    const newReportId = await generateTopicReport(
      user.id,
      originalReport.topic,
      originalReport.data_limited ?? false,
      persona,
      injectedInterpretation
    )

    // Mark the refresh credit consumed against the new report. The original
    // report stays as-is for comparison.
    await markCreditConsumed({
      creditId: refreshCredit.id,
      consumedForReportId: newReportId,
    })

    console.log(
      `[Refresh] Refreshed report ${originalReportId} → ${newReportId} for user ${user.id}`
    )

    return NextResponse.json({
      message: 'Refresh generation started',
      report_id: newReportId,
    })
  } catch (error) {
    console.error('Error in POST /api/reports/[id]/refresh:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
