// Stripe checkout session creation
// Handles both subscription (Pro Search) and one-time payment (Reports)

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { STRIPE_PRICES, REPORT_PRICE_CENTS } from '@/lib/stripe/config'
import { createPendingReportPurchase } from '@/lib/billing/usage'

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { type, topic, persona, dataLimited } = body as {
      type: 'subscription' | 'report'
      topic?: string
      persona?: 'researcher' | 'investor'
      dataLimited?: boolean
    }

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(user.id, user.email || '')

    if (type === 'subscription') {
      // Pro Search subscription checkout
      if (!STRIPE_PRICES.PRO_SUBSCRIPTION) {
        return NextResponse.json(
          { error: 'Pro subscription price not configured' },
          { status: 500 }
        )
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: STRIPE_PRICES.PRO_SUBSCRIPTION,
            quantity: 1,
          },
        ],
        success_url: `${appUrl}/account?checkout=success`,
        cancel_url: `${appUrl}/pricing?checkout=canceled`,
        metadata: {
          userId: user.id,
          type: 'subscription',
        },
      })

      return NextResponse.json({ url: session.url })
    } else if (type === 'report') {
      // One-time report payment
      if (!topic || !persona) {
        return NextResponse.json(
          { error: 'Missing topic or persona for report' },
          { status: 400 }
        )
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Intelligence Report: ${topic}`,
                description: `${persona === 'investor' ? 'Investment' : 'Research'} Intelligence Report`,
              },
              unit_amount: REPORT_PRICE_CENTS,
            },
            quantity: 1,
          },
        ],
        success_url: `${appUrl}/reports?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/reports?checkout=canceled`,
        metadata: {
          userId: user.id,
          type: 'report',
          topic,
          persona,
          dataLimited: dataLimited ? 'true' : 'false',
        },
      })

      // Create pending purchase record
      await createPendingReportPurchase(user.id, session.id, topic, persona)

      return NextResponse.json({ url: session.url, sessionId: session.id })
    }

    return NextResponse.json({ error: 'Invalid checkout type' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Stripe Checkout] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Get existing Stripe customer ID or create a new one
 */
async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('stripe_customer_id, full_name')
    .eq('id', userId)
    .single()

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name: profile?.full_name || undefined,
    metadata: {
      userId,
    },
  })

  // Save customer ID to profile
  await supabaseAdmin
    .from('user_profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId)

  return customer.id
}
