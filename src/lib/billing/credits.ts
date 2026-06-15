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
 *
 * NOTE: this is the non-atomic finalize step. For new code use the
 * tryClaimCredit + finalize / release pair below — markCreditConsumed
 * with no `consumed_at IS NULL` guard let two parallel requests both
 * pass the eligibility check, both run ~2 minutes of generation, and
 * both call this function, with only one credit consumed and a
 * duplicate orphan report left behind.
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

/**
 * Atomically claim a credit before running generation. Returns true if
 * this caller won the claim. Used to close the TOCTOU window between
 * "did this user have an unspent credit?" and "we just spent it" —
 * without this, two parallel POSTs (double-click, retry-after-timeout)
 * could both pass the eligibility check, both run a full ~2-minute
 * generation, only one consume the credit, and leave a duplicate
 * orphan report.
 *
 * The atomic guarantee comes from PostgREST's WHERE consumed_at IS
 * NULL clause: at most one concurrent UPDATE can match.
 *
 * Pair with finalizeCreditConsumption (on success) or releaseCredit
 * (on generation failure).
 */
export async function tryClaimCredit(creditId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('report_credits')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', creditId)
    .is('consumed_at', null)
    .select('id')

  if (error) {
    console.error('[credits] tryClaimCredit failed:', error)
    throw error
  }
  return (data?.length ?? 0) > 0
}

/**
 * After a successful claim + generation, write the resulting report
 * id onto the credit so the ledger reflects what the credit produced.
 */
export async function finalizeCreditConsumption(params: {
  creditId: string
  consumedForReportId: string
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('report_credits')
    .update({ consumed_for_report_id: params.consumedForReportId })
    .eq('id', params.creditId)

  if (error) {
    console.error('[credits] finalizeCreditConsumption failed:', error)
    throw error
  }
}

/**
 * Release a claim previously made by tryClaimCredit when the work
 * the claim was meant to fund (e.g., generation) fails. Leaves
 * consumed_for_report_id unchanged (it was never set in the claim
 * step).
 */
export async function releaseCredit(creditId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('report_credits')
    .update({ consumed_at: null })
    .eq('id', creditId)

  if (error) {
    console.error('[credits] releaseCredit failed:', error)
    // Don't throw — the caller is already in an error path; logging
    // is enough. A stranded claim is recoverable by support.
  }
}

/**
 * Auto-grant a retry credit when a report's generation fails technically.
 * Called from generate.ts's failure handler so the user has a recovery
 * path without needing to contact support. Idempotent — if a retry credit
 * already exists for this original report, this is a no-op.
 *
 * The grant is funded by goodwill (the user already paid for the failed
 * attempt), so source='failure_auto_grant' is the correct attribution.
 */
export async function autoGrantRetryCreditOnFailure(params: {
  userId: string
  originalReportId: string
}): Promise<void> {
  // Idempotency: don't double-grant if a retry credit already exists for
  // this original report.
  const { data: existing } = await supabaseAdmin
    .from('report_credits')
    .select('id')
    .eq('user_id', params.userId)
    .eq('original_report_id', params.originalReportId)
    .eq('source', 'failure_auto_grant')
    .limit(1)
    .maybeSingle()

  if (existing) return

  const expiresAt = twelveMonthsFromNow()
  const { error } = await supabaseAdmin.from('report_credits').insert({
    user_id: params.userId,
    credit_type: 'retry',
    source: 'failure_auto_grant',
    expires_at: expiresAt,
    original_report_id: params.originalReportId,
    notes: 'Auto-granted when the original report generation failed',
  })

  if (error) {
    console.error('[credits] autoGrantRetryCreditOnFailure failed:', error)
  }
}

/**
 * Self-serve retry grant. Called when the user submits feedback on a
 * completed report and asks for a retry. Eligibility is gated by the
 * 14-day window from the original report's created_at AND by checking
 * that no prior retry credit (failure_auto_grant or self_serve_retry)
 * exists for this original — one retry per original, no exceptions.
 *
 * Returns the granted credit id, or null when the user is ineligible.
 */
export async function grantSelfServeRetryCredit(params: {
  userId: string
  originalReportId: string
  originalCreatedAt: string
}): Promise<string | null> {
  // Eligibility: no prior retry on this original
  const { data: priorRetry } = await supabaseAdmin
    .from('report_credits')
    .select('id')
    .eq('user_id', params.userId)
    .eq('original_report_id', params.originalReportId)
    .eq('credit_type', 'retry')
    .limit(1)
    .maybeSingle()

  if (priorRetry) return null

  // Eligibility: original report ≤ 14 days old
  const ageMs = Date.now() - new Date(params.originalCreatedAt).getTime()
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000
  if (ageMs > FOURTEEN_DAYS_MS) return null

  const expiresAt = twelveMonthsFromNow()
  const { data, error } = await supabaseAdmin
    .from('report_credits')
    .insert({
      user_id: params.userId,
      credit_type: 'retry',
      source: 'self_serve_retry',
      expires_at: expiresAt,
      original_report_id: params.originalReportId,
      notes: 'Self-serve retry — granted on feedback submission within the 14-day window',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[credits] grantSelfServeRetryCredit failed:', error)
    return null
  }
  return data.id
}

/**
 * Find the unspent retry credit bound to a specific original report.
 * Returns the credit row or null. Used by the retry assistant endpoints
 * to verify entitlement before doing work.
 */
export async function findRetryCreditForReport(
  originalReportId: string,
  userId: string
): Promise<{ id: string; expiresAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('report_credits')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('credit_type', 'retry')
    .eq('original_report_id', originalReportId)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('granted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[credits] findRetryCreditForReport failed:', error)
    return null
  }
  if (!data) return null
  return { id: data.id, expiresAt: data.expires_at }
}
