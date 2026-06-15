// POST /api/reports/[id]/retry/generate
//
// Step 2 of the AI-assisted retry flow. The user has picked one of the
// three interpretations Claude proposed in the refine step. Consume the
// retry credit, generate a new report with the chosen interpretation,
// and finalize the retry_feedback row with chosen_interpretation +
// resulting_report_id.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateTopicReport } from '@/lib/reports'
import {
  findRetryCreditForReport,
  tryClaimCredit,
  finalizeCreditConsumption,
  releaseCredit,
} from '@/lib/billing/credits'
import type { ReportPersona } from '@/lib/reports/types'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ChosenInterpretation {
  label: string
  semanticQuery: string
  keywordQuery: string
  rationale?: string
}

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

    const body = await request.json()
    const feedbackId: string | null = typeof body.feedback_id === 'string' ? body.feedback_id : null
    const chosen = body.chosen_interpretation as ChosenInterpretation | undefined

    if (
      !chosen ||
      typeof chosen.label !== 'string' ||
      typeof chosen.semanticQuery !== 'string' ||
      typeof chosen.keywordQuery !== 'string'
    ) {
      return NextResponse.json(
        { error: 'chosen_interpretation is required (label, semanticQuery, keywordQuery)' },
        { status: 400 }
      )
    }

    const { data: originalReport, error: fetchError } = await supabaseAdmin
      .from('user_reports')
      .select('id, user_id, report_type, topic, persona, data_limited')
      .eq('id', originalReportId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !originalReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    if (originalReport.report_type !== 'topic' || !originalReport.topic) {
      return NextResponse.json(
        { error: 'Retry is only supported for topic reports' },
        { status: 400 }
      )
    }

    // Verify retry credit is still available. Refine step should have
    // granted one already, but be defensive — a stale tab or duplicate
    // submit shouldn't generate a second report.
    const retryCredit = await findRetryCreditForReport(originalReportId, user.id)
    if (!retryCredit) {
      return NextResponse.json(
        { error: 'No retry available for this report' },
        { status: 403 }
      )
    }

    // Atomically claim the credit BEFORE running generation — closes
    // the TOCTOU window between the eligibility check and the ~2-minute
    // generation. See the matching pattern in /api/reports/[id]/refresh.
    const claimed = await tryClaimCredit(retryCredit.id)
    if (!claimed) {
      return NextResponse.json(
        { error: 'A retry is already in progress for this report.' },
        { status: 409 }
      )
    }

    // Generate the new report with the user's chosen interpretation.
    const persona: ReportPersona =
      originalReport.persona === 'investor' ? 'investor' : 'researcher'

    let newReportId: string
    try {
      newReportId = await generateTopicReport(
        user.id,
        originalReport.topic,
        originalReport.data_limited ?? false,
        persona,
        {
          label: chosen.label,
          semanticQuery: chosen.semanticQuery,
          keywordQuery: chosen.keywordQuery,
        }
      )
    } catch (err) {
      // Release the claim so the user can retry without losing their
      // retry credit.
      await releaseCredit(retryCredit.id)
      throw err
    }

    // Finalize the credit's consumed_for_report_id (consumed_at was
    // already set during the atomic claim above).
    await finalizeCreditConsumption({
      creditId: retryCredit.id,
      consumedForReportId: newReportId,
    })

    // Finalize the retry_feedback row if we have an id. Non-fatal if it
    // fails — the new report is the user-facing outcome and is already
    // generated.
    if (feedbackId) {
      const { error: updateError } = await supabaseAdmin
        .from('retry_feedback')
        .update({
          chosen_interpretation: chosen,
          resulting_report_id: newReportId,
          generated_at: new Date().toISOString(),
        })
        .eq('id', feedbackId)
        .eq('user_id', user.id)

      if (updateError) {
        console.error('[retry/generate] Failed to finalize feedback row:', updateError)
      }
    }

    return NextResponse.json({
      message: 'Retry generation started',
      report_id: newReportId,
    })
  } catch (error) {
    console.error('Error in POST /api/reports/[id]/retry/generate:', error)
    const message = 'Retry generation failed. Please try again or contact support.'
    void error
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
