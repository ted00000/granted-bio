// Report credit ledger helpers
//
// Phase 2 of the landing+credits redesign — see docs/LANDING_AND_CREDITS_PLAN.md
// and supabase/migrations/20260608_report_credits.sql for the architectural
// rationale and table shape.
//
// The ledger captures every entitlement granted by a purchase, bypass, or
// auto-grant. Phase 2 operates in shadow-ledger mode: credits are written
// alongside the existing webhook + API flow and consumed immediately during
// generation, so the user-visible UX is unchanged. Phase 3 will read the
// ledger to surface refresh and retry features.

import { supabaseAdmin } from '@/lib/supabase'

/** Credit lifetime — purchase, bypass, and most grants share this window. */
const TWELVE_MONTHS_MS = 12 * 30 * 24 * 60 * 60 * 1000

function twelveMonthsFromNow(): string {
  return new Date(Date.now() + TWELVE_MONTHS_MS).toISOString()
}

/**
 * Grant the credits associated with a paid report purchase and immediately
 * consume the generation credit against the generated report. The refresh
 * credit is bound to that same report so it can later be spent to
 * re-synthesize the topic with current NIH data.
 *
 * This is the post-webhook hook — call it AFTER generateTopicReport returns
 * successfully so consumed_for_report_id and bound_to_report_id can be
 * populated atomically. If the webhook is retried with the same Stripe
 * session, the stripe_session_id index lets the caller bail out idempotently
 * before re-granting (see hasCreditsForStripeSession below).
 */
export async function grantPurchaseCredits(params: {
  userId: string
  reportId: string
  stripeSessionId: string
  stripePriceId?: string
}): Promise<void> {
  const expiresAt = twelveMonthsFromNow()
  const now = new Date().toISOString()

  const rows = [
    // Generation credit — consumed in the same operation that produced the
    // report it's tied to. The ledger preserves the "this purchase produced
    // this report" link independently of the report_purchases row.
    {
      user_id: params.userId,
      credit_type: 'generation' as const,
      source: 'purchase' as const,
      expires_at: expiresAt,
      consumed_at: now,
      consumed_for_report_id: params.reportId,
      stripe_session_id: params.stripeSessionId,
      stripe_price_id: params.stripePriceId ?? null,
    },
    // Refresh entitlement — granted at purchase, bound to the report this
    // purchase produced, unspent until the user clicks "Refresh" later.
    {
      user_id: params.userId,
      credit_type: 'refresh' as const,
      source: 'purchase' as const,
      expires_at: expiresAt,
      bound_to_report_id: params.reportId,
      stripe_session_id: params.stripeSessionId,
      stripe_price_id: params.stripePriceId ?? null,
    },
  ]

  const { error } = await supabaseAdmin.from('report_credits').insert(rows)
  if (error) {
    // Don't throw — the report has already been generated and the user has
    // their artifact. A failed ledger write is a recoverable bookkeeping
    // problem, not a user-visible failure.
    console.error('[credits] grantPurchaseCredits failed:', error)
  }
}

/**
 * Same shape as grantPurchaseCredits but for admin / associate / beta paths
 * that bypass payment. The source field captures why the credit was granted
 * so admin/support tooling can distinguish paid revenue from comped
 * generations later.
 */
export async function grantBypassCredits(params: {
  userId: string
  reportId: string
  source: 'admin_grant' | 'beta_grant'
}): Promise<void> {
  const expiresAt = twelveMonthsFromNow()
  const now = new Date().toISOString()

  const rows = [
    {
      user_id: params.userId,
      credit_type: 'generation' as const,
      source: params.source,
      expires_at: expiresAt,
      consumed_at: now,
      consumed_for_report_id: params.reportId,
    },
    {
      user_id: params.userId,
      credit_type: 'refresh' as const,
      source: params.source,
      expires_at: expiresAt,
      bound_to_report_id: params.reportId,
    },
  ]

  const { error } = await supabaseAdmin.from('report_credits').insert(rows)
  if (error) {
    console.error('[credits] grantBypassCredits failed:', error)
  }
}

/**
 * Idempotency probe used by the Stripe webhook before granting credits.
 * Returns true if any credit row has already been written for this Stripe
 * session id (i.e., the webhook fired before and the post-generation grant
 * was completed).
 */
export async function hasCreditsForStripeSession(
  stripeSessionId: string
): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('report_credits')
    .select('id', { count: 'exact', head: true })
    .eq('stripe_session_id', stripeSessionId)

  if (error) {
    console.error('[credits] hasCreditsForStripeSession query failed:', error)
    return false
  }
  return (count ?? 0) > 0
}

/**
 * Look up the unspent refresh credit bound to a specific report, if any.
 * Phase 3 will use this from the report-page "Refresh available?" check.
 * Returns null when no entitlement exists or it has already been consumed.
 */
export async function findRefreshCreditForReport(
  reportId: string,
  userId: string
): Promise<{ id: string; expiresAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('report_credits')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('credit_type', 'refresh')
    .eq('bound_to_report_id', reportId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[credits] findRefreshCreditForReport failed:', error)
    return null
  }
  if (!data) return null
  return { id: data.id, expiresAt: data.expires_at }
}

/**
 * Mark a previously-granted credit as consumed and bind it to the report it
 * produced. Used by Phase 3 when a refresh or retry is spent.
 */
export async function markCreditConsumed(params: {
  creditId: string
  consumedForReportId: string
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('report_credits')
    .update({
      consumed_at: new Date().toISOString(),
      consumed_for_report_id: params.consumedForReportId,
    })
    .eq('id', params.creditId)

  if (error) {
    console.error('[credits] markCreditConsumed failed:', error)
    throw error
  }
}
