// /receipt/[id] — redirects to the Stripe-hosted receipt URL for a
// completed purchase. We don't render our own receipt page; Stripe's
// hosted receipt is tax-aware, branded, printable, and stable. This
// route is just the indirection layer that:
//
// - confirms the caller owns the purchase (RLS would also enforce
//   this, but we want a clean error rather than a "not found"),
// - looks up the PaymentIntent on Stripe to get the current
//   receipt_url (we don't store it because it can change if Stripe
//   adjusts hosted-page URLs),
// - 302-redirects to that URL.
//
// Used from the /account page next to each completed purchase row.

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/client'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 })
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Send unauth'd visitors to the home page auth form with intent
    // preserved so post-login they land back here.
    const { id } = await params
    return NextResponse.redirect(
      new URL(`/?redirect=${encodeURIComponent(`/receipt/${id}`)}`, request.url)
    )
  }

  const { id } = await params

  // Look up the purchase via service-role so RLS doesn't interfere
  // with the ownership check (we enforce it ourselves below).
  const { data: purchase } = await supabaseAdmin
    .from('report_purchases')
    .select('id, user_id, status, stripe_payment_intent_id')
    .eq('id', id)
    .single()

  if (!purchase) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }
  if (purchase.user_id !== user.id) {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
  }
  if (purchase.status !== 'completed') {
    return NextResponse.json(
      { error: 'Receipt unavailable — purchase has not completed.' },
      { status: 400 }
    )
  }
  if (!purchase.stripe_payment_intent_id) {
    return NextResponse.json(
      { error: 'Receipt unavailable — no payment record on file.' },
      { status: 400 }
    )
  }

  // Resolve the receipt URL from the PaymentIntent. Stripe returns
  // the URL on the latest_charge; we expand it inline.
  try {
    const pi = await stripe.paymentIntents.retrieve(purchase.stripe_payment_intent_id, {
      expand: ['latest_charge'],
    })
    const latestCharge = pi.latest_charge
    const receiptUrl =
      latestCharge && typeof latestCharge !== 'string' ? latestCharge.receipt_url : null

    if (!receiptUrl) {
      return NextResponse.json(
        { error: 'Receipt URL not available from Stripe.' },
        { status: 502 }
      )
    }

    return NextResponse.redirect(receiptUrl)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Receipt] Stripe lookup failed:', message)
    return NextResponse.json({ error: 'Failed to load receipt.' }, { status: 500 })
  }
}
