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
    // 15 monthly searches. The first 10 are uninterrupted; at search
    // 10 the client surfaces a one-time soft modal framing the
    // remaining 5 as a goodwill bonus alongside the report pitch.
    // The hard wall fires at 15. Bumped from 10 when Pro Search was
    // removed from the marketing surface so free users have more
    // room to validate their topic before the report ask lands.
    searchesPerMonth: 15,
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

// Threshold at which the free tier's "we gave you 5 more on us" soft
// modal fires (once per month per device, via localStorage). The
// effective monthly cap is TIER_LIMITS.free.searchesPerMonth; this is
// just the conversion-moment trigger.
export const FREE_SEARCH_SOFT_PITCH_AT = 10

// What the UI displays as the user's monthly search limit. We hide
// the bonus 5 until they've actually crossed the soft-pitch threshold,
// so the "we gave you 5 more on us" modal lands as a real gift
// instead of contradicting a sidebar that already revealed the full
// 15. Once searchesUsed >= FREE_SEARCH_SOFT_PITCH_AT the displayed
// limit reveals as the full cap. Pro / beta / admin / unlimited users
// see their real limit at all times.
export function getDisplayedSearchLimit(
  searchesUsed: number,
  actualLimit: number,
  tier: 'free' | 'pro' | 'beta' | null | undefined
): number {
  if (tier !== 'free') return actualLimit
  if (searchesUsed < FREE_SEARCH_SOFT_PITCH_AT) return FREE_SEARCH_SOFT_PITCH_AT
  return actualLimit
}

// Stripe price IDs (set in environment).
//
// PRO_SUBSCRIPTION is commented out as part of the 2026-06-11 pricing
// simplification — granted.bio sells single $199 reports + a free
// account tier; the recurring Pro Search subscription was removed
// from the marketing surface to keep the funnel single-message. The
// shape is preserved so the channel can be revived later if a
// repositioned subscription (e.g., seat-based BD search) makes sense.
export const STRIPE_PRICES = {
  // PRO_SUBSCRIPTION: process.env.STRIPE_PRO_PRICE_ID || '',
  REPORT: process.env.STRIPE_REPORT_PRICE_ID || '',
}

// Report pricing — the on-purchase amount that lands on the Stripe
// checkout session. Must match every marketing surface (home pricing
// card, /pricing, /reports, sample CTA). Was $99 from an earlier
// pricing model; corrected to $199 with the simplification.
export const REPORT_PRICE_CENTS = 19900 // $199

// Pro Search subscription price — preserved for future revival.
// export const PRO_SUBSCRIPTION_PRICE_CENTS = 4900 // $49/month

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
