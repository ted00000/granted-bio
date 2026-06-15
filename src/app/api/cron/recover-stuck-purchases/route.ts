// Recovery cron for stuck report purchases.
//
// The Stripe webhook completes the purchase atomically and then runs
// generation in a Vercel `after()` background context so the webhook
// can respond 200 within ~100ms. That covers the common case. The
// rare-but-real case: the background work dies before
// linkReportToPurchase runs (function instance killed mid-flight,
// deploy, etc.) — leaving a purchase with status='completed' but
// report_id=NULL.
//
// This cron sweeps for that condition: completed purchases without a
// linked report, past a grace window, with attempts remaining. Re-
// fetches the Stripe session for metadata and re-runs the same
// generation path the webhook uses.
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { supabaseAdmin } from '@/lib/supabase'
import { runReportGenerationForSession } from '@/app/api/stripe/webhook/route'
import type { ReportPersona } from '@/lib/reports/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow the function plenty of headroom — recovery may run one full
// generation (~2 min) per stuck purchase, processed sequentially.
export const maxDuration = 800

const GRACE_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const MAX_ATTEMPTS = 3
const BATCH_LIMIT = 3 // process at most 3 stuck purchases per cron tick

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    console.error('[cron/recover-stuck-purchases] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!stripe) {
    console.error('[cron/recover-stuck-purchases] Stripe client not configured')
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const cutoff = new Date(Date.now() - GRACE_WINDOW_MS).toISOString()

  const { data: stuck, error } = await supabaseAdmin
    .from('report_purchases')
    .select('id, stripe_checkout_session_id, user_id, recovery_attempts')
    .eq('status', 'completed')
    .is('report_id', null)
    .lt('completed_at', cutoff)
    .lt('recovery_attempts', MAX_ATTEMPTS)
    .order('completed_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (error) {
    console.error('[cron/recover-stuck-purchases] lookup failed:', error)
    return NextResponse.json(
      { error: 'Lookup failed', details: error.message },
      { status: 500 }
    )
  }

  if (!stuck || stuck.length === 0) {
    return NextResponse.json({ recovered: 0, skipped: 0, failed: 0 })
  }

  console.log(`[cron/recover-stuck-purchases] found ${stuck.length} stuck purchase(s)`)

  let recovered = 0
  let failed = 0

  for (const purchase of stuck) {
    if (!purchase.stripe_checkout_session_id) {
      failed++
      continue
    }

    // Increment attempts BEFORE running so a crash mid-retry still
    // counts toward the max. Atomic so concurrent cron invocations
    // (shouldn't happen with Vercel cron but cheap to be safe) don't
    // double-process.
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('report_purchases')
      .update({ recovery_attempts: purchase.recovery_attempts + 1 })
      .eq('id', purchase.id)
      .eq('recovery_attempts', purchase.recovery_attempts)
      .is('report_id', null)
      .select('id')

    if (claimError || !claim || claim.length === 0) {
      console.log(`[cron/recover-stuck-purchases] purchase ${purchase.id} already claimed elsewhere, skipping`)
      continue
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(
        purchase.stripe_checkout_session_id
      )
      const metadata = session.metadata || {}

      if (!metadata.userId || !metadata.topic || !metadata.persona) {
        console.error(
          `[cron/recover-stuck-purchases] purchase ${purchase.id} missing required metadata; cannot recover`
        )
        failed++
        continue
      }

      const persona: ReportPersona =
        metadata.persona === 'investor' ? 'investor' : 'researcher'
      const dataLimited = metadata.dataLimited === 'true'
      let interpretation:
        | { semanticQuery: string; keywordQuery: string; label: string }
        | undefined
      if (metadata.interpretation) {
        try {
          const parsed = JSON.parse(metadata.interpretation)
          if (
            parsed &&
            typeof parsed.semanticQuery === 'string' &&
            typeof parsed.keywordQuery === 'string' &&
            typeof parsed.label === 'string'
          ) {
            interpretation = parsed
          }
        } catch {
          // best-effort, fall through
        }
      }

      await runReportGenerationForSession(
        purchase.stripe_checkout_session_id,
        metadata.userId,
        metadata.topic,
        persona,
        dataLimited,
        interpretation
      )

      recovered++
      console.log(`[cron/recover-stuck-purchases] recovered purchase ${purchase.id}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      console.error(
        `[cron/recover-stuck-purchases] recovery failed for purchase ${purchase.id}:`,
        message
      )
      failed++
    }
  }

  return NextResponse.json({
    recovered,
    failed,
    inspected: stuck.length,
  })
}
