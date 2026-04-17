// Stripe webhook handler
// Handles subscription lifecycle and report payment events

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { supabaseAdmin } from '@/lib/supabase'
import { completeReportPurchase, linkReportToPurchase } from '@/lib/billing/usage'
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

    // Idempotency check: see if this session already has a completed purchase with a report
    const { data: existingPurchase } = await supabaseAdmin
      .from('report_purchases')
      .select('id, status, report_id')
      .eq('stripe_checkout_session_id', session.id)
      .single()

    if (existingPurchase?.status === 'completed' && existingPurchase?.report_id) {
      console.log(`[Stripe Webhook] Purchase for session ${session.id} already completed with report ${existingPurchase.report_id}, skipping`)
      return
    }

    // Mark purchase as completed
    await completeReportPurchase(session.id, paymentIntentId)
    console.log(`[Stripe Webhook] Completed report purchase for session ${session.id}`)

    // Trigger report generation
    if (metadata.type === 'report' && metadata.topic && metadata.persona && metadata.userId) {
      const persona: ReportPersona = metadata.persona === 'investor' ? 'investor' : 'researcher'
      const dataLimited = metadata.dataLimited === 'true'

      console.log(`[Stripe Webhook] Starting report generation for user ${metadata.userId}`)

      // Generate report and link to purchase
      const reportId = await generateTopicReport(
        metadata.userId,
        metadata.topic,
        dataLimited,
        persona
      )

      // Get purchase ID to link report
      const { data: purchase } = await supabaseAdmin
        .from('report_purchases')
        .select('id')
        .eq('stripe_checkout_session_id', session.id)
        .single()

      if (purchase) {
        await linkReportToPurchase(purchase.id, reportId)
        console.log(`[Stripe Webhook] Linked report ${reportId} to purchase ${purchase.id}`)
      }
    }
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
