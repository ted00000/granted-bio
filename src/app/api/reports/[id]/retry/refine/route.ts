// POST /api/reports/[id]/retry/refine
//
// Step 1 of the AI-assisted retry flow. User submits dissatisfaction
// feedback; Claude analyzes the failed/disliked report and proposes three
// reformulated interpretations the user can pick from. The retry credit
// is granted (failure auto-grant or self-serve within 14 days) but not
// yet consumed — consumption happens at the generate step in the next
// endpoint if and only if the user proceeds.
//
// Persists a retry_feedback row capturing the complaint + proposals so we
// have a learning signal even if the user doesn't follow through to
// generation.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  findRetryCreditForReport,
  grantSelfServeRetryCredit,
} from '@/lib/billing/credits'
import {
  retryAssistantInterpretation,
  type RetryFeedbackCategory,
  type RetryProposal,
} from '@/lib/reports/retry-assistant'

export const runtime = 'nodejs'
export const maxDuration = 60

const VALID_CATEGORIES: RetryFeedbackCategory[] = [
  'projects_wrong',
  'too_narrow',
  'too_broad',
  'missed_aspect',
  'wrong_field',
]

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
    const feedbackCategory = body.feedbackCategory as RetryFeedbackCategory
    const feedbackText = typeof body.feedbackText === 'string' ? body.feedbackText.trim() : null

    if (!VALID_CATEGORIES.includes(feedbackCategory)) {
      return NextResponse.json(
        { error: 'Invalid feedbackCategory' },
        { status: 400 }
      )
    }

    // Load the original report — must be owned by caller, must be a topic
    // report. Both complete and failed reports are eligible for retry.
    const { data: originalReport, error: fetchError } = await supabaseAdmin
      .from('user_reports')
      .select('id, user_id, report_type, topic, persona, status, interpretation, agent_outputs, created_at')
      .eq('id', originalReportId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !originalReport) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    if (originalReport.report_type !== 'topic') {
      return NextResponse.json(
        { error: 'Retry is only supported for topic reports' },
        { status: 400 }
      )
    }

    if (!originalReport.topic) {
      return NextResponse.json(
        { error: 'Original report has no topic' },
        { status: 400 }
      )
    }

    // Find an existing retry credit, or attempt to grant one self-serve.
    let retryCredit = await findRetryCreditForReport(originalReportId, user.id)
    if (!retryCredit) {
      // Self-serve grant: only completed reports within 14 days are
      // eligible. Failed reports already had failure_auto_grant fired on
      // failure, so they should find one via findRetryCreditForReport.
      if (originalReport.status === 'complete') {
        const grantedId = await grantSelfServeRetryCredit({
          userId: user.id,
          originalReportId,
          originalCreatedAt: originalReport.created_at,
        })
        if (grantedId) {
          retryCredit = await findRetryCreditForReport(originalReportId, user.id)
        }
      }
    }

    if (!retryCredit) {
      return NextResponse.json(
        {
          error:
            'No retry available for this report. Retries are limited to one per report and available within 14 days of generation.',
        },
        { status: 403 }
      )
    }

    // Extract top project titles from the original report's agent outputs.
    // For failed reports, agent_outputs may be NULL — pass an empty list.
    const agentOutputs = originalReport.agent_outputs as
      | { projects?: { items?: Array<{ title?: string }> } }
      | null
    const topProjectTitles =
      agentOutputs?.projects?.items
        ?.slice(0, 10)
        .map((p) => p.title)
        .filter((t): t is string => typeof t === 'string') ?? []

    // Ask Claude for three reformulated interpretations.
    const proposals: RetryProposal[] = await retryAssistantInterpretation({
      originalTopic: originalReport.topic,
      originalInterpretation:
        originalReport.interpretation &&
        typeof originalReport.interpretation === 'object'
          ? (originalReport.interpretation as {
              semanticQuery: string
              keywordQuery: string
              label: string
            })
          : null,
      topProjectTitles,
      feedbackCategory,
      feedbackText,
    })

    if (proposals.length === 0) {
      return NextResponse.json(
        { error: 'Could not generate refinement proposals. Please try again.' },
        { status: 502 }
      )
    }

    // Persist the retry_feedback row. chosen_interpretation and
    // resulting_report_id are populated at the generate step.
    const { data: feedbackRow, error: insertError } = await supabaseAdmin
      .from('retry_feedback')
      .insert({
        user_id: user.id,
        original_report_id: originalReportId,
        feedback_category: feedbackCategory,
        feedback_text: feedbackText,
        claude_proposed_interpretations: proposals,
        retry_credit_id: retryCredit.id,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[retry/refine] Failed to persist feedback row:', insertError)
      // Non-fatal — proposals can still be returned to the user.
    }

    return NextResponse.json({
      feedback_id: feedbackRow?.id ?? null,
      proposals,
    })
  } catch (error) {
    console.error('Error in POST /api/reports/[id]/retry/refine:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
