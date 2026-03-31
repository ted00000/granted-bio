'use client'

import { useState } from 'react'
import { X, Zap, Search, FileText, Check, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface UpgradePromptProps {
  type: 'search_limit'
  tier: 'free' | 'pro'
  limit: number
  onClose: () => void
}

export function UpgradePrompt({ type, tier, limit, onClose }: UpgradePromptProps) {
  const [loading, setLoading] = useState(false)

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription' }),
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (err) {
      console.error('Checkout error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-[#E07A5F] to-[#F4A261] px-6 py-8 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 text-white/80 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Zap className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-semibold">
              Search Limit Reached
            </h2>
          </div>

          <p className="text-white/90">
            You&apos;ve used all {limit} of your free searches this month.
            Upgrade to Pro Search for unlimited access.
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-semibold text-gray-900">$49</span>
            <span className="text-gray-500">/month</span>
          </div>

          <ul className="space-y-3 mb-6">
            <li className="flex items-center gap-3 text-sm">
              <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span className="text-gray-700">500 searches per month</span>
            </li>
            <li className="flex items-center gap-3 text-sm">
              <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span className="text-gray-700">Full result details (200 per query)</span>
            </li>
            <li className="flex items-center gap-3 text-sm">
              <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span className="text-gray-700">Export to CSV</span>
            </li>
            <li className="flex items-center gap-3 text-sm">
              <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span className="text-gray-700">PI names and affiliations</span>
            </li>
          </ul>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full py-3 px-4 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                'Loading...'
              ) : (
                <>
                  Upgrade to Pro
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <Link
              href="/pricing"
              className="text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              View all plans
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
