// Search-limit modal — replaces the prior "Upgrade to Pro Search"
// pitch with a report-purchase nudge after the marketing-side Pro
// removal (2026-06-11). Two modes:
//
// - 'soft' fires once per month when the free user crosses the
//   FREE_SEARCH_SOFT_PITCH_AT threshold (10/15). Framed as "we gave
//   you 5 more on us" so the user gets a goodwill carrot alongside
//   the report ask. Dismissable; doesn't block further searches.
// - 'hard' fires when the API returns 402 (limit reached). Shows the
//   reset date so the user knows when they'll get more searches.
//   Same report CTA. Dismissable.
//
// past_due is preserved as a legacy safety branch for any users who
// hold a real Pro subscription from before the simplification — they
// still need a path to the Stripe billing portal to fix payment.

'use client'

import { useState } from 'react'
import { X, Search, FileText, ArrowRight, Sparkles } from 'lucide-react'
import Link from 'next/link'

export type UpgradePromptMode = 'soft' | 'hard'

interface UpgradePromptProps {
  mode: UpgradePromptMode
  /** Searches used in the current period. Drives the headline copy. */
  searchesUsed: number
  /** The free-tier monthly cap (currently 15). */
  limit: number
  /** Legacy: if a real Pro subscription is past_due, route to portal. */
  subscriptionStatus?: string | null
  onClose: () => void
}

// First of next month, in local time. Search counters reset on the
// first of each month per the existing usage logic.
function getNextResetDate(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export function UpgradePrompt({
  mode,
  searchesUsed,
  limit,
  subscriptionStatus,
  onClose,
}: UpgradePromptProps) {
  const [loading, setLoading] = useState(false)
  const isPaymentFailed = subscriptionStatus === 'past_due'

  // Legacy: a Pro subscriber in past_due needs the billing portal, not
  // the report pitch. Route them there.
  const handleFixPayment = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (err) {
      console.error('Portal error:', err)
    } finally {
      setLoading(false)
    }
  }

  const resetDate = getNextResetDate()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-dialog-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#E07A5F] to-[#F4A261] px-6 py-7 text-white">
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 p-1 text-white/80 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              {isPaymentFailed ? (
                <Search className="w-5 h-5" aria-hidden="true" />
              ) : mode === 'soft' ? (
                <Sparkles className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Search className="w-5 h-5" aria-hidden="true" />
              )}
            </div>
            <h2 id="upgrade-dialog-title" className="text-xl font-semibold">
              {isPaymentFailed
                ? 'Payment Failed'
                : mode === 'soft'
                  ? '5 more searches, on us'
                  : 'Search limit reached'}
            </h2>
          </div>

          <p className="text-white/90 text-sm leading-relaxed">
            {isPaymentFailed ? (
              <>Your last payment didn&apos;t go through. Update your payment method to restore access.</>
            ) : mode === 'soft' ? (
              <>
                You&apos;ve hit {searchesUsed} searches this month. We bumped you up
                to {limit} so you can keep validating your topic — and if
                searching isn&apos;t cutting it, the report tells you what the
                results mean together.
              </>
            ) : (
              <>
                You&apos;ve used all {limit} free searches this month. Resets {resetDate}.
                Want the synthesis without the searching?
              </>
            )}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {isPaymentFailed ? (
            <div className="flex flex-col gap-3">
              <button
                onClick={handleFixPayment}
                disabled={loading}
                className="w-full py-3 px-4 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  'Loading...'
                ) : (
                  <>
                    Update payment method
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              <Link
                href="/account"
                className="text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Go to account
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-gray-50 rounded-lg p-4 mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-[#E07A5F]" strokeWidth={1.5} />
                  <span className="text-sm font-medium text-gray-900">
                    Intelligence Report — $199
                  </span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Cross-source synthesis of every project, trial, patent, and
                  publication on your topic — funding trends, competitive
                  topology, IP landscape, strategic narrative. Two minutes to
                  generate, three months of drill-down access.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Link
                  href="/reports"
                  onClick={onClose}
                  className="w-full py-3 px-4 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors flex items-center justify-center gap-2"
                >
                  Generate a Report
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  onClick={onClose}
                  className="text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {mode === 'soft' ? 'Keep searching' : 'Close'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
