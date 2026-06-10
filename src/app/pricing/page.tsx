'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X, Zap, FileText, Search, ArrowRight } from 'lucide-react'
import { MarketingNav } from '@/components/MarketingNav'

export default function PricingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState<'subscription' | null>(null)

  const handleSubscribe = async () => {
    setLoading('subscription')
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subscription' }),
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else if (data.error) {
        console.error('Checkout error:', data.error)
        // If unauthorized, redirect to login
        if (response.status === 401) {
          router.push('/?redirect=/pricing')
        }
      }
    } catch (err) {
      console.error('Checkout error:', err)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Strategic intelligence reports priced to use, not to ration.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-8 mb-16">
          {/* Free Tier */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Free</h2>
              <p className="text-gray-600 text-sm">
                Get started with basic search access
              </p>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-semibold text-gray-900">$0</span>
              <span className="text-gray-500">/month</span>
            </div>

            <Link
              href="/"
              className="block w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium text-center hover:bg-gray-200 transition-colors mb-8"
            >
              Get Started Free
            </Link>

            <ul className="space-y-3">
              <Feature included>10 searches per month</Feature>
              <Feature included>Basic search results (10 per query)</Feature>
              <Feature included>Project, trial, and publication data</Feature>
              <Feature>Full result details</Feature>
              <Feature>Export to CSV</Feature>
              <Feature>PI names and affiliations</Feature>
            </ul>
          </div>

          {/* Pro Tier */}
          <div className="bg-white rounded-2xl border-2 border-[#E07A5F] p-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#E07A5F] text-white text-xs font-medium rounded-full">
              Most Popular
            </div>

            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Pro Search</h2>
              <p className="text-gray-600 text-sm">
                Full platform access for serious researchers
              </p>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-semibold text-gray-900">$49</span>
              <span className="text-gray-500">/month</span>
            </div>

            <button
              onClick={handleSubscribe}
              disabled={loading === 'subscription'}
              className="block w-full py-3 px-4 bg-[#E07A5F] text-white rounded-lg font-medium text-center hover:bg-[#C96A4F] transition-colors mb-8 disabled:opacity-50"
            >
              {loading === 'subscription' ? 'Loading...' : 'Subscribe to Pro'}
            </button>

            <ul className="space-y-3">
              <Feature included>500 searches per month</Feature>
              <Feature included>Full result details (200 per query)</Feature>
              <Feature included>Project abstracts and summaries</Feature>
              <Feature included>Export to CSV</Feature>
              <Feature included>PI names and affiliations</Feature>
            </ul>
          </div>
        </div>

        {/* Reports Section */}
        <div className="bg-white rounded-2xl border border-gray-200 p-8 mb-16">
          <div className="flex items-start gap-6">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Intelligence Reports
              </h2>
              <p className="text-gray-600 mb-4">
                Comprehensive research or investment intelligence on any topic.
                Includes funding analysis, competitive landscape, IP assessment,
                and strategic recommendations.
              </p>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-semibold text-gray-900">$199</span>
                <span className="text-gray-500">per report</span>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Check className="w-4 h-4 text-emerald-500" />
                  Researcher, investor, or BD lens
                </span>
                <span className="flex items-center gap-1">
                  <Check className="w-4 h-4 text-emerald-500" />
                  One free refresh within 12 months
                </span>
                <span className="flex items-center gap-1">
                  <Check className="w-4 h-4 text-emerald-500" />
                  Refine &amp; regenerate, free, if not satisfied
                </span>
              </div>
            </div>
            <Link
              href="/reports"
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors flex-shrink-0"
            >
              Generate Report
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Time ROI — replaces the prior "How we compare" cost-comparison
            table. Per the locked pricing-framing rule we don't lead with
            "cheaper than X"; instead we anchor on the time the synthesis
            takes to build by hand, even with AI assistance. */}
        <div className="bg-gray-50 rounded-2xl p-8 mb-16">
          <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">
            What this takes to build by hand
          </h2>
          <p className="text-sm text-gray-500 text-center mb-8 max-w-2xl mx-auto">
            Even with AI assistance, building the equivalent synthesis is
            real engineering work — querying, cross-linking, deduping, and
            verifying across four datasets.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* On your own */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                On your own
              </div>
              <h3 className="font-semibold text-gray-900 mb-4">
                The manual workflow
              </h3>
              <ul className="space-y-2.5 text-sm text-gray-600 mb-6">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Search and filter NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Cross-link ~100 records by project number
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Read abstracts, extract methodology and competitive signal
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Aggregate funding stats, build visuals, write the synthesis
                </li>
              </ul>
              <div className="mt-auto pt-4 border-t border-gray-100">
                <div className="text-2xl font-semibold text-gray-900">~25 hours</div>
                <div className="text-xs text-gray-500 mt-1">
                  of analyst time, even with AI assistance
                </div>
              </div>
            </div>

            {/* With granted.bio */}
            <div className="bg-white rounded-xl border-2 border-[#E07A5F]/30 p-6 flex flex-col shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-[#E07A5F] font-semibold mb-2">
                With granted.bio
              </div>
              <h3 className="font-semibold text-gray-900 mb-4">
                The report, ready
              </h3>
              <ul className="space-y-2.5 text-sm text-gray-600 mb-6">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  One topic, one click
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Cross-source synthesis, every reference auditable
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Drill into every linked record for 3 months
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  One free refresh within 12 months
                </li>
              </ul>
              <div className="mt-auto pt-4 border-t border-gray-100">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-gray-900">2 minutes</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-2xl font-semibold text-[#E07A5F]">$199</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-sm text-gray-500 text-center mt-8 max-w-2xl mx-auto italic">
            At analyst rates, the report pays for itself the first time you skip
            the manual workflow.
          </p>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            <FAQ
              question="Can I use reports without a Pro subscription?"
              answer="Yes! Intelligence reports are available to all users at $199 each. A Pro subscription is only needed for expanded search access (500 searches/month vs 10)."
            />
            <FAQ
              question="What data sources do you use?"
              answer="We aggregate data from NIH RePORTER (grants), ClinicalTrials.gov, USPTO (patents), and PubMed (publications). All data is linked and searchable through our AI-powered interface."
            />
            <FAQ
              question="Can I cancel my subscription anytime?"
              answer="Yes, you can cancel your Pro subscription at any time. You'll retain access until the end of your current billing period."
            />
            <FAQ
              question="What's included in an Intelligence Report?"
              answer="Each report includes executive summary, funding analysis, competitive landscape, IP assessment, clinical development status, key publications, and strategic recommendations tailored to your chosen persona (Researcher or Investor)."
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-gray-500">
          <p>granted.bio - AI-powered life science intelligence</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Feature({ children, included = false }: { children: React.ReactNode; included?: boolean }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      {included ? (
        <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <X className="w-4 h-4 text-gray-300 flex-shrink-0" />
      )}
      <span className={included ? 'text-gray-700' : 'text-gray-400'}>{children}</span>
    </li>
  )
}

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-medium text-gray-900 mb-2">{question}</h3>
      <p className="text-sm text-gray-600">{answer}</p>
    </div>
  )
}
