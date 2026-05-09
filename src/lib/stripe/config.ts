// Stripe configuration and tier limits

export type BillingTier = 'free' | 'pro'

export interface TierLimits {
  searchesPerMonth: number
  resultsLimit: number
  canExport: boolean
  canSeeEmails: boolean
  canSeeAbstracts: boolean
}

export const TIER_LIMITS: Record<BillingTier, TierLimits> = {
  free: {
    searchesPerMonth: 10,
    resultsLimit: 10,
    canExport: false,
    canSeeEmails: false,
    canSeeAbstracts: false,
  },
  pro: {
    searchesPerMonth: 500,
    resultsLimit: 200,
    canExport: true,
    canSeeEmails: true,
    canSeeAbstracts: true,
  },
}

// Stripe price IDs (set in environment)
export const STRIPE_PRICES = {
  PRO_SUBSCRIPTION: process.env.STRIPE_PRO_PRICE_ID || '',
  REPORT: process.env.STRIPE_REPORT_PRICE_ID || '',
}

// Report pricing
export const REPORT_PRICE_CENTS = 9900 // $99
export const PRO_SUBSCRIPTION_PRICE_CENTS = 4900 // $49/month

// Map database tier values to billing tiers
// The database has legacy tiers (basic, advanced, unlimited) that all map to 'pro'
// Beta tier maps to 'pro' for search limits, but only while beta_expires_at is in the future.
export function mapDatabaseTierToBillingTier(
  dbTier: string | null,
  subscriptionStatus: string | null,
  betaExpiresAt?: string | null
): BillingTier {
  // Beta tier — get pro perks while not expired
  if (dbTier === 'beta') {
    if (!betaExpiresAt) return 'free'
    if (new Date(betaExpiresAt) > new Date()) return 'pro'
    return 'free'
  }
  // Paid pro: only treat as 'pro' if subscription is active
  if (subscriptionStatus === 'active' && dbTier && dbTier !== 'free') {
    return 'pro'
  }
  return 'free'
}

// Get tier limits for a user
export function getTierLimits(tier: BillingTier): TierLimits {
  return TIER_LIMITS[tier]
}
