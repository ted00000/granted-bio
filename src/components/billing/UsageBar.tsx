'use client'

import Link from 'next/link'

interface UsageBarProps {
  used: number
  limit: number
  tier: 'free' | 'pro'
  compact?: boolean
}

export function UsageBar({ used, limit, tier, compact = false }: UsageBarProps) {
  const percent = Math.min((used / limit) * 100, 100)
  const isLow = percent >= 80
  const isEmpty = percent >= 100

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isEmpty
                ? 'bg-red-500'
                : isLow
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-gray-500">
          {used}/{limit}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-700">
          {used} of {limit} searches
        </span>
        {tier === 'free' && isLow && (
          <Link
            href="/pricing"
            className="text-xs text-[#E07A5F] hover:underline"
          >
            Upgrade
          </Link>
        )}
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isEmpty
              ? 'bg-red-500'
              : isLow
                ? 'bg-amber-500'
                : 'bg-emerald-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isEmpty && tier === 'free' && (
        <p className="text-xs text-red-600">
          Search limit reached.{' '}
          <Link href="/pricing" className="font-medium underline hover:no-underline">
            Upgrade to Pro
          </Link>{' '}
          for 500 searches/month.
        </p>
      )}
    </div>
  )
}
