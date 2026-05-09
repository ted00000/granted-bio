// Usage tracking for search quotas

import { supabaseAdmin } from '@/lib/supabase'
import { TIER_LIMITS, mapDatabaseTierToBillingTier, type BillingTier } from '@/lib/stripe/config'

export interface UsageCheckResult {
  allowed: boolean
  remaining: number
  limit: number
  tier: BillingTier
  subscriptionStatus: string | null
}

export interface UserUsage {
  tier: BillingTier
  searches: {
    used: number
    limit: number
    remaining: number
  }
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
}

/**
 * Check if user can perform a search and increment counter if allowed
 */
export async function checkAndIncrementSearch(userId: string): Promise<UsageCheckResult> {
  // Get user profile with usage data
  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('role, tier, subscription_status, beta_expires_at, searches_this_month, searches_reset_at')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    // User not found - treat as free tier with 0 searches
    return {
      allowed: false,
      remaining: 0,
      limit: TIER_LIMITS.free.searchesPerMonth,
      tier: 'free',
      subscriptionStatus: null,
    }
  }

  // Admin role has unlimited access
  if (profile.role === 'admin') {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      tier: 'pro',
      subscriptionStatus: 'active',
    }
  }

  // Associate role gets pro tier limits (500/month) but is tracked
  if (profile.role === 'associate') {
    // Force pro tier for associates regardless of subscription status
    const limit = TIER_LIMITS.pro.searchesPerMonth
    const resetAt = profile.searches_reset_at ? new Date(profile.searches_reset_at) : new Date()
    const now = new Date()
    const monthAgo = new Date()
    monthAgo.setMonth(monthAgo.getMonth() - 1)
    let currentSearches = profile.searches_this_month || 0

    if (resetAt < monthAgo) {
      currentSearches = 0
      await supabaseAdmin
        .from('user_profiles')
        .update({ searches_this_month: 0, searches_reset_at: now.toISOString() })
        .eq('id', userId)
    }

    const remaining = Math.max(0, limit - currentSearches)
    const allowed = currentSearches < limit

    if (allowed) {
      await supabaseAdmin
        .from('user_profiles')
        .update({ searches_this_month: currentSearches + 1 })
        .eq('id', userId)
      return { allowed: true, remaining: remaining - 1, limit, tier: 'pro', subscriptionStatus: 'active' }
    }
    return { allowed: false, remaining: 0, limit, tier: 'pro', subscriptionStatus: 'active' }
  }

  // Map to billing tier (beta gets pro perks while not expired)
  const tier = mapDatabaseTierToBillingTier(
    profile.tier,
    profile.subscription_status,
    profile.beta_expires_at
  )
  const limit = TIER_LIMITS[tier].searchesPerMonth

  // Check if we need to reset monthly counter
  const resetAt = profile.searches_reset_at ? new Date(profile.searches_reset_at) : new Date()
  const now = new Date()
  const monthAgo = new Date()
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  let currentSearches = profile.searches_this_month || 0

  if (resetAt < monthAgo) {
    // Reset the counter
    currentSearches = 0
    await supabaseAdmin
      .from('user_profiles')
      .update({
        searches_this_month: 0,
        searches_reset_at: now.toISOString(),
      })
      .eq('id', userId)
  }

  // Check if under limit
  const remaining = Math.max(0, limit - currentSearches)
  const allowed = currentSearches < limit

  if (allowed) {
    // Increment the counter
    await supabaseAdmin
      .from('user_profiles')
      .update({
        searches_this_month: currentSearches + 1,
      })
      .eq('id', userId)

    return {
      allowed: true,
      remaining: remaining - 1, // After this search
      limit,
      tier,
      subscriptionStatus: profile.subscription_status,
    }
  }

  return {
    allowed: false,
    remaining: 0,
    limit,
    tier,
    subscriptionStatus: profile.subscription_status,
  }
}

/**
 * Get user's current usage without incrementing
 */
export async function getUserUsage(userId: string): Promise<UserUsage> {
  const { data: profile, error } = await supabaseAdmin
    .from('user_profiles')
    .select('role, tier, subscription_status, beta_expires_at, current_period_end, searches_this_month, searches_reset_at')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return {
      tier: 'free',
      searches: {
        used: 0,
        limit: TIER_LIMITS.free.searchesPerMonth,
        remaining: TIER_LIMITS.free.searchesPerMonth,
      },
      subscriptionStatus: null,
      currentPeriodEnd: null,
    }
  }

  // Admin role has unlimited access
  if (profile.role === 'admin') {
    return {
      tier: 'pro',
      searches: {
        used: profile.searches_this_month || 0,
        limit: Infinity,
        remaining: Infinity,
      },
      subscriptionStatus: 'active',
      currentPeriodEnd: null,
    }
  }

  // Associate role gets pro tier limits (500/month)
  if (profile.role === 'associate') {
    const limit = TIER_LIMITS.pro.searchesPerMonth
    const resetAt = profile.searches_reset_at ? new Date(profile.searches_reset_at) : new Date()
    const monthAgo = new Date()
    monthAgo.setMonth(monthAgo.getMonth() - 1)
    const used = resetAt < monthAgo ? 0 : (profile.searches_this_month || 0)
    return {
      tier: 'pro',
      searches: { used, limit, remaining: Math.max(0, limit - used) },
      subscriptionStatus: 'active',
      currentPeriodEnd: null,
    }
  }

  const tier = mapDatabaseTierToBillingTier(
    profile.tier,
    profile.subscription_status,
    profile.beta_expires_at
  )
  const limit = TIER_LIMITS[tier].searchesPerMonth

  // Check if we need to reset (read-only check)
  const resetAt = profile.searches_reset_at ? new Date(profile.searches_reset_at) : new Date()
  const monthAgo = new Date()
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  const used = resetAt < monthAgo ? 0 : (profile.searches_this_month || 0)
  const remaining = Math.max(0, limit - used)

  return {
    tier,
    searches: {
      used,
      limit,
      remaining,
    },
    subscriptionStatus: profile.subscription_status,
    currentPeriodEnd: profile.current_period_end,
  }
}

/**
 * Check if a report purchase is completed for a given checkout session
 */
export async function checkReportPurchase(checkoutSessionId: string): Promise<{
  paid: boolean
  purchaseId: string | null
  topic: string | null
  persona: string | null
}> {
  const { data: purchase } = await supabaseAdmin
    .from('report_purchases')
    .select('id, status, topic, persona')
    .eq('stripe_checkout_session_id', checkoutSessionId)
    .single()

  if (!purchase) {
    return { paid: false, purchaseId: null, topic: null, persona: null }
  }

  return {
    paid: purchase.status === 'completed',
    purchaseId: purchase.id,
    topic: purchase.topic,
    persona: purchase.persona,
  }
}

/**
 * Create a pending report purchase record
 */
export async function createPendingReportPurchase(
  userId: string,
  checkoutSessionId: string,
  topic: string,
  persona: 'researcher' | 'investor'
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('report_purchases')
    .insert({
      user_id: userId,
      stripe_checkout_session_id: checkoutSessionId,
      topic,
      persona,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to create purchase record: ${error.message}`)
  }

  return data.id
}

/**
 * Mark a report purchase as completed
 */
export async function completeReportPurchase(
  checkoutSessionId: string,
  paymentIntentId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('report_purchases')
    .update({
      status: 'completed',
      stripe_payment_intent_id: paymentIntentId,
      completed_at: new Date().toISOString(),
    })
    .eq('stripe_checkout_session_id', checkoutSessionId)

  if (error) {
    throw new Error(`Failed to complete purchase: ${error.message}`)
  }
}

/**
 * Link a generated report to its purchase record
 */
export async function linkReportToPurchase(
  purchaseId: string,
  reportId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('report_purchases')
    .update({ report_id: reportId })
    .eq('id', purchaseId)

  if (error) {
    throw new Error(`Failed to link report: ${error.message}`)
  }
}

// ============================================
// API Usage Tracking (for associate billing)
// ============================================

export interface ApiUsageParams {
  userId: string
  endpoint: 'chat' | 'report'
  persona?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

// Anthropic pricing (per million tokens) - Sonnet 4
const PRICING = {
  input: 3,        // $3/M input tokens
  output: 15,      // $15/M output tokens
  cacheRead: 0.3,  // $0.30/M (10% of input)
  cacheWrite: 3.75 // $3.75/M (125% of input)
}

/**
 * Calculate cost in cents from token counts
 */
export function calculateCostCents(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const inputCost = (inputTokens * PRICING.input) / 1_000_000
  const outputCost = (outputTokens * PRICING.output) / 1_000_000
  const cacheReadCost = (cacheReadTokens * PRICING.cacheRead) / 1_000_000
  const cacheWriteCost = (cacheWriteTokens * PRICING.cacheWrite) / 1_000_000

  // Convert dollars to cents
  return (inputCost + outputCost + cacheReadCost + cacheWriteCost) * 100
}

/**
 * Log API usage for a user (for associate billing)
 */
export async function logApiUsage(params: ApiUsageParams): Promise<void> {
  const costCents = calculateCostCents(
    params.inputTokens,
    params.outputTokens,
    params.cacheReadTokens || 0,
    params.cacheWriteTokens || 0
  )

  const { error } = await supabaseAdmin
    .from('api_usage')
    .insert({
      user_id: params.userId,
      endpoint: params.endpoint,
      persona: params.persona || null,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      cache_read_tokens: params.cacheReadTokens || 0,
      cache_write_tokens: params.cacheWriteTokens || 0,
      cost_cents: costCents,
    })

  if (error) {
    // Log but don't throw - usage tracking shouldn't break the API
    console.error('[API Usage] Failed to log usage:', error.message)
  }
}

/**
 * Get user's API usage summary for the current month
 */
export async function getMonthlyApiUsage(userId: string): Promise<{
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
}> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('cost_cents, input_tokens, output_tokens')
    .eq('user_id', userId)
    .gte('created_at', startOfMonth.toISOString())

  if (error || !data) {
    return {
      totalCostCents: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      callCount: 0,
    }
  }

  return {
    totalCostCents: data.reduce((sum, row) => sum + Number(row.cost_cents), 0),
    totalInputTokens: data.reduce((sum, row) => sum + row.input_tokens, 0),
    totalOutputTokens: data.reduce((sum, row) => sum + row.output_tokens, 0),
    callCount: data.length,
  }
}
