'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  User,
  Search,
  FileText,
  CreditCard,
  ExternalLink,
  ArrowRight,
  Check,
  AlertCircle,
  Loader2,
  Activity,
} from 'lucide-react'
import { MarketingNav } from '@/components/MarketingNav'

type ReportPurchase = {
  id: string
  topic: string
  persona: 'researcher' | 'investor'
  status: 'pending' | 'completed' | 'refunded' | 'failed'
  created_at: string
  completed_at: string | null
  report_id: string | null
}

type ApiUsage = {
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
}

type UsageData = {
  role: 'user' | 'admin' | 'associate'
  tier: 'free' | 'pro'
  searchesUsed: number
  searchLimit: number
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | 'trialing' | null
  currentPeriodEnd: string | null
  reportPurchases: ReportPurchase[]
  apiUsage: ApiUsage | null
}

export default function AccountPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    fetchUsage()
  }, [])

  const fetchUsage = async () => {
    try {
      const response = await fetch('/api/billing/usage')
      if (response.status === 401) {
        router.push('/?redirect=/account')
        return
      }
      if (!response.ok) {
        throw new Error('Failed to fetch usage')
      }
      const data = await response.json()
      setUsage(data)
    } catch (err) {
      setError('Failed to load account information')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleManageSubscription = async () => {
    setPortalLoading(true)
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
      })
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      }
    } catch (err) {
      console.error('Portal error:', err)
    } finally {
      setPortalLoading(false)
    }
  }

  const handleUpgrade = async () => {
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
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error || !usage) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <MarketingNav />
        <main className="max-w-3xl mx-auto px-6 py-16">
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Unable to load account
            </h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              Try Again
            </button>
          </div>
        </main>
      </div>
    )
  }

  const usagePercent = Math.min(
    (usage.searchesUsed / usage.searchLimit) * 100,
    100
  )
  const isPro = usage.tier === 'pro'
  const isActive = usage.subscriptionStatus === 'active'
  const isAssociate = usage.role === 'associate'

  const formatCost = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`
  }

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-8">
          Account
        </h1>

        <div className="space-y-6">
          {/* Current Plan */}
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    Current Plan
                  </h2>
                  <div className="flex items-center gap-2">
                    {isAssociate ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        Associate
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isPro
                            ? 'bg-[#E07A5F]/10 text-[#E07A5F]'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {isPro ? 'Pro Search' : 'Free'}
                      </span>
                    )}
                    {isPro && usage.subscriptionStatus && !isAssociate && (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : usage.subscriptionStatus === 'past_due'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {usage.subscriptionStatus === 'active' && 'Active'}
                        {usage.subscriptionStatus === 'past_due' &&
                          'Past Due'}
                        {usage.subscriptionStatus === 'canceled' && 'Canceled'}
                        {usage.subscriptionStatus === 'trialing' && 'Trial'}
                      </span>
                    )}
                  </div>
                  {isPro && usage.currentPeriodEnd && (
                    <p className="text-sm text-gray-500 mt-2">
                      {usage.subscriptionStatus === 'canceled'
                        ? 'Access until'
                        : 'Renews'}{' '}
                      {new Date(usage.currentPeriodEnd).toLocaleDateString(
                        'en-US',
                        {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        }
                      )}
                    </p>
                  )}
                </div>
              </div>
              {isAssociate ? (
                <span className="text-sm text-gray-500">Unlimited access</span>
              ) : isPro ? (
                <button
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {portalLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ExternalLink className="w-4 h-4" />
                  )}
                  Manage
                </button>
              ) : (
                <button
                  onClick={handleUpgrade}
                  className="flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors"
                >
                  Upgrade to Pro
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </section>

          {/* API Usage for Associates */}
          {isAssociate && usage.apiUsage && (
            <section className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    API Usage
                  </h2>
                  <p className="text-sm text-gray-500 mb-4">This month</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-2xl font-semibold text-gray-900">
                        {formatCost(usage.apiUsage.totalCostCents)}
                      </div>
                      <div className="text-sm text-gray-500">Total cost</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-2xl font-semibold text-gray-900">
                        {usage.apiUsage.callCount}
                      </div>
                      <div className="text-sm text-gray-500">API calls</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-2xl font-semibold text-gray-900">
                        {formatTokens(usage.apiUsage.totalInputTokens)}
                      </div>
                      <div className="text-sm text-gray-500">Input tokens</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="text-2xl font-semibold text-gray-900">
                        {formatTokens(usage.apiUsage.totalOutputTokens)}
                      </div>
                      <div className="text-sm text-gray-500">Output tokens</div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 mt-4">
                    Usage is tracked for billing purposes. You will receive an invoice at the end of each month.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Search Usage for regular users */}
          {!isAssociate && (
            <section className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Search className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    Search Usage
                  </h2>
                  <p className="text-sm text-gray-500 mb-4">This month</p>

                  <div className="mb-2">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-2xl font-semibold text-gray-900">
                        {usage.searchesUsed}
                      </span>
                      <span className="text-sm text-gray-500">
                        of {usage.searchLimit} searches
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          usagePercent >= 90
                            ? 'bg-red-500'
                            : usagePercent >= 70
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>

                  {!isPro && usagePercent >= 80 && (
                    <p className="text-sm text-amber-600 mt-3">
                      Running low on searches.{' '}
                      <button
                        onClick={handleUpgrade}
                        className="font-medium underline hover:no-underline"
                      >
                        Upgrade to Pro
                      </button>{' '}
                      to get up to 500 monthly searches.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Report History */}
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Intelligence Reports
                  </h2>
                  <p className="text-sm text-gray-500">$99 per report</p>
                </div>
              </div>
              <Link
                href="/reports"
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
              >
                Generate Report
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {usage.reportPurchases.length > 0 ? (
              <div className="border-t border-gray-100 pt-4 mt-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">
                  Recent Purchases
                </h3>
                <div className="space-y-3">
                  {usage.reportPurchases.map((purchase) => (
                    <div
                      key={purchase.id}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {purchase.topic}
                        </p>
                        <p className="text-xs text-gray-500">
                          {purchase.persona === 'researcher'
                            ? 'Research'
                            : 'Investment'}{' '}
                          Report -{' '}
                          {new Date(purchase.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            purchase.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : purchase.status === 'pending'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {purchase.status === 'completed' && (
                            <Check className="w-3 h-3 mr-1" />
                          )}
                          {purchase.status.charAt(0).toUpperCase() +
                            purchase.status.slice(1)}
                        </span>
                        {purchase.report_id && (
                          <Link
                            href={`/reports/${purchase.report_id}`}
                            className="text-sm text-[#E07A5F] hover:underline"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border-t border-gray-100 pt-4 mt-4 text-center py-6">
                <p className="text-sm text-gray-500">No reports purchased yet</p>
              </div>
            )}
          </section>

          {/* Billing - only for Pro subscribers, not associates */}
          {isPro && !isAssociate && (
            <section className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">
                    Billing
                  </h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Manage payment methods, view invoices, and update billing
                    details.
                  </p>
                  <button
                    onClick={handleManageSubscription}
                    disabled={portalLoading}
                    className="flex items-center gap-2 text-sm text-[#E07A5F] hover:underline disabled:opacity-50"
                  >
                    {portalLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4" />
                    )}
                    Open Billing Portal
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

