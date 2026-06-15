// Stripe webhook handler
// Handles subscription lifecycle and report payment events.
//
// Report generation is run in the background via Next.js after() so
// the webhook returns 200 to Stripe in ~100ms instead of waiting on
// the ~2-minute generation. Without this, Stripe's ~30s response
// expectation triggered retries that hit the same handler again,
// causing duplicate generations. The atomic claim in
// completeReportPurchase guarantees that even if retries do arrive,
// only one invocation runs generation. If the background work itself
// dies (function instance killed mid-flight, deploy, etc.), the
// recovery cron at /api/cron/recover-stuck-purchases picks the
// purchase up after a grace window and retries.

import { after, NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { supabaseAdmin } from '@/lib/supabase'
import { completeReportPurchase, linkReportToPurchase } from '@/lib/billing/usage'
import { grantPurchaseCredits, hasCreditsForStripeSession } from '@/lib/billing/credits'
import { generateTopicReport } from '@/lib/reports'
import type { ReportPersona } from '@/lib/reports/types'
import type Stripe from 'stripe'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request: NextRequest) {
  if (!stripe) {
    console.error('[Stripe Webhook] Stripe client not initialized')
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 })
  }

  if (!webhookSecret) {
    console.error('[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Stripe Webhook] Signature verification failed:', message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Handle completed checkout sessions
 * - Subscription: activate Pro tier
 * - Payment (report): mark report as paid
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log(`[Stripe Webhook] Checkout completed: ${session.id}, mode: ${session.mode}`)

  if (session.mode === 'subscription') {
    // Pro subscription checkout
    const customerId = session.customer as string
    const subscriptionId = session.subscription as string

    // Get the subscription details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription

    // Find user by Stripe customer ID and check idempotency
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('id, stripe_subscription_id')
      .eq('stripe_customer_id', customerId)
      .single()

    if (profile) {
      // Idempotency check: skip if already processed this subscription
      if (profile.stripe_subscription_id === subscriptionId) {
        console.log(`[Stripe Webhook] Subscription ${subscriptionId} already processed for user ${profile.id}, skipping`)
        return
      }

      // Get current period end from subscription items (Stripe SDK v20+)
      const periodEnd = subscription.items?.data[0]?.current_period_end

      await supabaseAdmin
        .from('user_profiles')
        .update({
          tier: 'pro',
          stripe_subscription_id: subscriptionId,
          subscription_status: subscription.status,
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        })
        .eq('id', profile.id)

      console.log(`[Stripe Webhook] Activated Pro for user ${profile.id}`)
    }
  } else if (session.mode === 'payment') {
    // One-time report payment
    const paymentIntentId = session.payment_intent as string
    const metadata = session.metadata || {}

    // Atomic claim: completeReportPurchase only succeeds if the row's
    // status was still 'pending'. If a previous webhook invocation
    // already claimed it, claimed === false and we bail. This is the
    // only correct idempotency point — the prior "status=='completed'
    // AND report_id is set" check did not catch retries during the
    // ~2-minute generation window (when status had already flipped to
    // 'completed' but the linkage had not yet been written), which is
    // exactly when Stripe retries because our generation runs much
    // longer than its ~30s response expectation. See
    // src/lib/billing/usage.ts:completeReportPurchase for the SQL.
    const { claimed } = await completeReportPurchase(session.id, paymentIntentId)
    if (!claimed) {
      console.log(`[Stripe Webhook] Session ${session.id} already claimed by another invocation, skipping`)
      return
    }
    console.log(`[Stripe Webhook] Completed report purchase for session ${session.id}`)

    // Spawn the long-running generation in the background so the
    // webhook can return 200 to Stripe within ~100ms. The atomic
    // claim above prevents a retry from kicking off a second
    // generation in parallel. If this background work dies (instance
    // killed, deploy mid-flight), the recovery cron picks the
    // purchase up after the grace window and retries.
    //
    // Read the interpretation from the report_purchases row, not from
    // Stripe metadata — Stripe caps each metadata value at 500 chars
    // and broad interpretations exceed that, so we persist it on the
    // purchase row in full. See the corresponding change in
    // /api/stripe/checkout.
    if (metadata.type === 'report' && metadata.topic && metadata.persona && metadata.userId) {
      const persona: ReportPersona = metadata.persona === 'investor' ? 'investor' : 'researcher'
      const dataLimited = metadata.dataLimited === 'true'
      const { userId, topic } = metadata

      const { data: purchaseRow } = await supabaseAdmin
        .from('report_purchases')
        .select('interpretation')
        .eq('stripe_checkout_session_id', session.id)
        .single()
      const interpretation = parsePurchaseInterpretation(purchaseRow?.interpretation)

      after(async () => {
        try {
          await runReportGenerationForSession(
            session.id,
            userId,
            topic,
            persona,
            dataLimited,
            interpretation
          )
        } catch (err) {
          // Don't rethrow — after() failures don't get communicated
          // to Stripe anyway (we already returned 200), and we want
          // the recovery cron to see the still-empty report_id and
          // retry.
          console.error(
            `[Stripe Webhook] Background generation failed for session ${session.id}:`,
            err
          )
        }
      })
    }
  }
}

interface Interpretation {
  semanticQuery: string
  keywordQuery: string
  label: string
}

// Validate the interpretation read from report_purchases.interpretation
// (JSONB). Best-effort: a missing or malformed value falls back to
// the legacy auto-rewrite path inside the projects agent. Exported
// so the recovery cron can use the same shape check.
export function parsePurchaseInterpretation(
  raw: unknown
): Interpretation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const parsed = raw as Record<string, unknown>
  if (
    typeof parsed.semanticQuery === 'string' &&
    typeof parsed.keywordQuery === 'string' &&
    typeof parsed.label === 'string'
  ) {
    return {
      semanticQuery: parsed.semanticQuery,
      keywordQuery: parsed.keywordQuery,
      label: parsed.label,
    }
  }
  return undefined
}

// Run report generation for a paid session, link it to the purchase,
// and grant the credit-ledger entries. Exported so the recovery cron
// can call the same path. Idempotent at each step: generation is
// gated by the atomic purchase claim, linkReportToPurchase is safe
// to call repeatedly, and grantPurchaseCredits is itself
// idempotent against the stripe_session_id index.
export async function runReportGenerationForSession(
  sessionId: string,
  userId: string,
  topic: string,
  persona: ReportPersona,
  dataLimited: boolean,
  interpretation: Interpretation | undefined
): Promise<void> {
  console.log(`[Stripe Webhook] Starting report generation for user ${userId}`)

  const reportId = await generateTopicReport(
    userId,
    topic,
    dataLimited,
    persona,
    interpretation
  )

  // Grant credits BEFORE linking the purchase. If credits throw, the
  // purchase stays unlinked, and the recovery cron picks it up on the
  // next tick (looks for purchases with status='completed' and
  // report_id IS NULL). The cron's "linked existing" branch then
  // links + re-attempts the grant (no-op via the hasCreditsForStripeSession
  // idempotency check if the first grant actually succeeded). If we
  // linked first, a grant failure would orphan a purchase with no
  // ledger row and no recovery signal.
  const alreadyHasCredits = await hasCreditsForStripeSession(sessionId)
  if (!alreadyHasCredits) {
    await grantPurchaseCredits({
      userId,
      reportId,
      stripeSessionId: sessionId,
    })
    console.log(`[Stripe Webhook] Granted purchase credits for session ${sessionId}`)
  } else {
    console.log(`[Stripe Webhook] Credits already granted for session ${sessionId}, skipping`)
  }

  const { data: purchase } = await supabaseAdmin
    .from('report_purchases')
    .select('id')
    .eq('stripe_checkout_session_id', sessionId)
    .single()

  if (purchase) {
    await linkReportToPurchase(purchase.id, reportId)
    console.log(`[Stripe Webhook] Linked report ${reportId} to purchase ${purchase.id}`)
  }
}

/**
 * Handle subscription updates (renewals, plan changes)
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  const periodEnd = subscription.items?.data[0]?.current_period_end
  const newPeriodEndDate = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, subscription_status, current_period_end')
    .eq('stripe_customer_id', customerId)
    .single()

  if (profile) {
    // Determine tier based on subscription status
    const tier = subscription.status === 'active' ? 'pro' : 'free'

    // Idempotency check: detect if this is an actual renewal (period_end changed)
    // Only reset search counter when the billing period actually renewed
    const isRenewal = profile.current_period_end &&
      newPeriodEndDate &&
      newPeriodEndDate !== profile.current_period_end &&
      subscription.status === 'active'

    // Skip if status and period_end are unchanged (duplicate webhook)
    if (
      profile.subscription_status === subscription.status &&
      profile.current_period_end === newPeriodEndDate
    ) {
      console.log(`[Stripe Webhook] Subscription update for user ${profile.id} unchanged, skipping`)
      return
    }

    const updateData: Record<string, unknown> = {
      tier,
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      current_period_end: newPeriodEndDate,
    }

    // Only reset search counter on actual renewal, not just any status update
    if (isRenewal) {
      updateData.searches_this_month = 0
      updateData.searches_reset_at = new Date().toISOString()
      console.log(`[Stripe Webhook] Detected renewal for user ${profile.id}, resetting search counter`)
    }

    await supabaseAdmin
      .from('user_profiles')
      .update(updateData)
      .eq('id', profile.id)

    console.log(`[Stripe Webhook] Updated subscription for user ${profile.id}: ${subscription.status}`)
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, subscription_status, stripe_subscription_id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (profile) {
    // Idempotency check: skip if already canceled or different subscription
    if (profile.subscription_status === 'canceled' || profile.stripe_subscription_id !== subscription.id) {
      console.log(`[Stripe Webhook] Subscription ${subscription.id} already canceled or mismatched for user ${profile.id}, skipping`)
      return
    }

    await supabaseAdmin
      .from('user_profiles')
      .update({
        tier: 'free',
        subscription_status: 'canceled',
        stripe_subscription_id: null,
      })
      .eq('id', profile.id)

    console.log(`[Stripe Webhook] Downgraded user ${profile.id} to free tier`)
  }
}

/**
 * Handle failed payments
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single()

  if (profile) {
    await supabaseAdmin
      .from('user_profiles')
      .update({
        subscription_status: 'past_due',
      })
      .eq('id', profile.id)

    console.log(`[Stripe Webhook] Marked user ${profile.id} as past_due`)
  }
}
