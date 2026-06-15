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
import {
  parsePurchaseInterpretation,
  runReportGenerationForSession,
} from '@/app/api/stripe/webhook/route'
import { linkReportToPurchase } from '@/lib/billing/usage'
import { grantPurchaseCredits, hasCreditsForStripeSession } from '@/lib/billing/credits'
import type { ReportPersona } from '@/lib/reports/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Allow the function plenty of headroom — recovery may run one full
// generation (~2 min) per stuck purchase, processed sequentially.
export const maxDuration = 800

const GRACE_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const MAX_ATTEMPTS = 3
const BATCH_LIMIT = 3 // process at most 3 stuck purchases per cron tick
// How long a user_reports row can stay in status='generating' before
// we consider the background after() dead and clean up. Generation
// takes ~2 min normally; 10 min is a generous safety margin.
const STUCK_GENERATING_MS = 10 * 60 * 1000

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
    .select(
      'id, stripe_checkout_session_id, user_id, recovery_attempts, completed_at, interpretation'
    )
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
    return NextResponse.json({
      inspected: 0,
      recovered: 0,
      linked_existing: 0,
      still_running: 0,
      failed: 0,
    })
  }

  console.log(`[cron/recover-stuck-purchases] found ${stuck.length} stuck purchase(s)`)

  let recovered = 0
  let linkedExisting = 0
  let stillRunning = 0
  let failed = 0

  for (const purchase of stuck) {
    if (!purchase.stripe_checkout_session_id || !purchase.completed_at) {
      failed++
      continue
    }

    // Resolve Stripe metadata first so we have user_id + topic to
    // check for existing user_reports rows. Skipping the lookup here
    // would force us to re-run generation blindly and risk creating
    // a duplicate user_reports row when after() managed to insert one
    // before dying.
    let session
    try {
      session = await stripe.checkout.sessions.retrieve(
        purchase.stripe_checkout_session_id
      )
    } catch (err) {
      console.error(
        `[cron/recover-stuck-purchases] failed to fetch Stripe session for purchase ${purchase.id}:`,
        err instanceof Error ? err.message : err
      )
      failed++
      continue
    }

    const metadata = session.metadata || {}
    if (!metadata.userId || !metadata.topic || !metadata.persona) {
      console.error(
        `[cron/recover-stuck-purchases] purchase ${purchase.id} missing required metadata; cannot recover`
      )
      failed++
      continue
    }

    // Look for user_reports rows this purchase's after() may have
    // produced before dying. Match user_id + topic + created_at >
    // purchase.completed_at — the topic string matches the Stripe
    // metadata exactly because both come from the same dialog input.
    const { data: existing } = await supabaseAdmin
      .from('user_reports')
      .select('id, status, created_at')
      .eq('user_id', metadata.userId)
      .eq('topic', metadata.topic)
      .gt('created_at', purchase.completed_at)
      .order('created_at', { ascending: false })

    const complete = existing?.find((r) => r.status === 'complete')
    if (complete) {
      // Partial-progress recovery: generation succeeded but the
      // post-generation grant / link steps died before committing.
      // Grant credits BEFORE linking the report — same ordering as
      // the webhook's runReportGenerationForSession. If the grant
      // throws, leaving the purchase unlinked means we'll re-enter
      // this branch on the next cron tick. Don't consume a recovery
      // attempt — this isn't a generation retry.
      try {
        const alreadyHasCredits = await hasCreditsForStripeSession(
          purchase.stripe_checkout_session_id
        )
        if (!alreadyHasCredits) {
          await grantPurchaseCredits({
            userId: metadata.userId,
            reportId: complete.id,
            stripeSessionId: purchase.stripe_checkout_session_id,
          })
        }
        await linkReportToPurchase(purchase.id, complete.id)
        linkedExisting++
        console.log(
          `[cron/recover-stuck-purchases] linked existing complete report ${complete.id} to purchase ${purchase.id}`
        )
      } catch (err) {
        console.error(
          `[cron/recover-stuck-purchases] failed to link existing report ${complete.id} for purchase ${purchase.id}:`,
          err instanceof Error ? err.message : err
        )
        failed++
      }
      continue
    }

    const generating = existing?.find((r) => r.status === 'generating')
    if (generating) {
      const ageMs = Date.now() - new Date(generating.created_at).getTime()
      if (ageMs < STUCK_GENERATING_MS) {
        // after() is plausibly still running. Skip this tick and
        // re-check on the next cron run. Don't consume a recovery
        // attempt — we haven't tried anything yet.
        stillRunning++
        console.log(
          `[cron/recover-stuck-purchases] report ${generating.id} still generating (age ${Math.round(ageMs / 1000)}s), skipping`
        )
        continue
      }
      // Stuck in 'generating' beyond the safety window. The
      // background after() is dead. We'll delete this row (and any
      // failed leftovers) below after the atomic claim — running
      // generation fresh produces a clean new row instead of leaving
      // the orphan around. The user briefly seeing a deleted-row gap
      // is preferable to ending up with N duplicates across retries.
      console.log(
        `[cron/recover-stuck-purchases] report ${generating.id} stuck in generating; will delete and regenerate`
      )
    }

    // No existing complete or still-running report — atomically
    // claim this recovery attempt and run generation. The compare-
    // and-set on recovery_attempts protects against concurrent cron
    // invocations (very unlikely with Vercel cron, but cheap).
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('report_purchases')
      .update({ recovery_attempts: purchase.recovery_attempts + 1 })
      .eq('id', purchase.id)
      .eq('recovery_attempts', purchase.recovery_attempts)
      .is('report_id', null)
      .select('id')

    if (claimError || !claim || claim.length === 0) {
      console.log(
        `[cron/recover-stuck-purchases] purchase ${purchase.id} already claimed by another invocation, skipping`
      )
      continue
    }

    // Clean up any non-complete rows left behind by prior recovery
    // attempts or a dead after(). generateTopicReport unconditionally
    // INSERTs a fresh row, so without this deletion each retry stacks
    // an additional failed/stuck row alongside the eventual successful
    // one. We've already confirmed no `complete` row exists for this
    // user+topic (the linked-existing branch above would have taken
    // it), so deleting `not eq 'complete'` is safe and won't touch
    // legitimate prior generations.
    const orphanIds = (existing ?? [])
      .filter((r) => r.status !== 'complete')
      .map((r) => r.id)
    if (orphanIds.length > 0) {
      const { error: cleanupError } = await supabaseAdmin
        .from('user_reports')
        .delete()
        .in('id', orphanIds)
      if (cleanupError) {
        console.error(
          `[cron/recover-stuck-purchases] failed to delete orphan rows ${orphanIds.join(',')}:`,
          cleanupError.message
        )
        // Continue anyway — duplicate rows are better than no retry.
      } else {
        console.log(
          `[cron/recover-stuck-purchases] deleted ${orphanIds.length} orphan row(s) before regeneration`
        )
      }
    }

    const persona: ReportPersona =
      metadata.persona === 'investor' ? 'investor' : 'researcher'
    const dataLimited = metadata.dataLimited === 'true'
    // Source of truth for interpretation is the purchase row (JSONB,
    // no truncation), not Stripe metadata. See the matching note in
    // the checkout + webhook routes.
    const interpretation = parsePurchaseInterpretation(purchase.interpretation)

    try {
      await runReportGenerationForSession(
        purchase.stripe_checkout_session_id,
        metadata.userId,
        metadata.topic,
        persona,
        dataLimited,
        interpretation
      )
      recovered++
      console.log(
        `[cron/recover-stuck-purchases] regenerated and linked purchase ${purchase.id}`
      )
    } catch (err) {
      console.error(
        `[cron/recover-stuck-purchases] regeneration failed for purchase ${purchase.id}:`,
        err instanceof Error ? err.message : err
      )
      failed++
    }
  }

  return NextResponse.json({
    inspected: stuck.length,
    recovered,
    linked_existing: linkedExisting,
    still_running: stillRunning,
    failed,
  })
}
