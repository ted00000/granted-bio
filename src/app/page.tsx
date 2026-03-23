'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import {
  Search,
  Clock,
  Database,
  ArrowRight,
  Check,
  FlaskConical,
  TrendingUp,
  Briefcase,
  FileText,
  X,
} from 'lucide-react'

function AuthForm() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/chat'

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState<'google' | 'magic' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const supabase = createBrowserSupabaseClient()

  const handleGoogleSignIn = async () => {
    setLoading('google')
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${redirect}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(null)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading('magic')
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${redirect}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(null)
    } else {
      setMagicLinkSent(true)
    }
  }

  if (magicLinkSent) {
    return (
      <div className="w-full py-8 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Check your email</h3>
        <p className="text-sm text-gray-500">
          We sent a sign-in link to<br />
          <span className="text-gray-900">{email}</span>
        </p>
        <button
          onClick={() => setMagicLinkSent(false)}
          className="mt-4 text-sm text-gray-500 hover:text-gray-900"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      {/* Google Sign In */}
      <button
        onClick={handleGoogleSignIn}
        disabled={loading !== null}
        className="w-full py-3 px-4 bg-white border border-gray-200 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {loading === 'google' ? 'Signing in...' : 'Continue with Google'}
      </button>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-400">or</span>
        </div>
      </div>

      {/* Magic Link */}
      <form onSubmit={handleMagicLink} className="space-y-3">
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <button
          type="submit"
          disabled={loading !== null}
          className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
        >
          {loading === 'magic' ? 'Sending...' : 'Sign in with email'}
        </button>
      </form>

      <p className="text-xs text-gray-400 text-center">
        We'll send you a magic link to sign in
      </p>
    </div>
  )
}

function AuthFormFallback() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-200 rounded-lg" />
    </div>
  )
}

const stats = [
  { label: 'NIH Projects', value: '129K' },
  { label: 'Patents', value: '46K' },
  { label: 'Publications', value: '203K' },
  { label: 'Clinical Trials', value: '38K' },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-2xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </span>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/reports" className="text-gray-600 hover:text-gray-900 transition-colors">
              Reports
            </Link>
            <Link href="/pricing" className="text-gray-600 hover:text-gray-900 transition-colors">
              Pricing
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="py-16 md:py-24 px-6 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 md:gap-24 items-start">
              {/* Left column */}
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#E07A5F]/10 text-[#E07A5F] rounded-full text-sm font-medium">
                    <Search className="w-4 h-4" />
                    Life Science Intelligence
                  </div>
                  <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 leading-tight">
                    Stop keyword-searching.<br />
                    Start finding.
                  </h1>
                  <p className="text-lg text-gray-500 leading-relaxed">
                    Skip hours of hit-or-miss searching across NIH RePORTER, ClinicalTrials.gov,
                    PubMed, and USPTO. Our AI understands your topic semantically and surfaces
                    what actually matters - in minutes.
                  </p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 pt-6 border-t border-gray-100">
                  {stats.map((stat) => (
                    <div key={stat.label}>
                      <div className="text-2xl font-semibold text-gray-900">
                        {stat.value}
                      </div>
                      <div className="text-xs text-gray-500">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right column - Auth */}
              <div className="w-full md:max-w-sm md:ml-auto">
                <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm w-full">
                  <h2 className="text-lg font-medium text-gray-900 mb-6">
                    Get started free
                  </h2>
                  <Suspense fallback={<AuthFormFallback />}>
                    <AuthForm />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value Props */}
        <section className="py-16 px-6 border-t border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <Search className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Semantic Understanding</h3>
                <p className="text-sm text-gray-600">
                  AI understands your topic conceptually, not just keywords. Search for "CRISPR delivery"
                  and find projects describing "guide RNA transport" or "Cas9 cellular uptake."
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <Database className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Four Databases, One Search</h3>
                <p className="text-sm text-gray-600">
                  NIH RePORTER, ClinicalTrials.gov, PubMed, and USPTO - all unified.
                  No more switching between sites with different interfaces and query syntaxes.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Minutes, Not Hours</h3>
                <p className="text-sm text-gray-600">
                  Skip the hours of hit-or-miss keyword searching. Get focused, relevant
                  results ranked by semantic relevance - what actually matters surfaces first.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 px-6 bg-white border-y border-gray-100">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-4">
              Semantic search, not keyword guessing
            </h2>
            <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
              Traditional database searches rely on exact keywords - you miss relevant projects
              that use different terminology. Our AI understands meaning and finds what matters.
            </p>

            <div className="grid md:grid-cols-2 gap-8">
              {/* The Problem */}
              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-200">
                <div className="flex items-center gap-2 mb-4">
                  <X className="w-5 h-5 text-red-500" />
                  <h3 className="font-semibold text-gray-900">Without granted.bio</h3>
                </div>
                <ul className="space-y-3 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Search 4 different databases separately
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Learn each site's different query syntax
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Guess which keywords researchers might have used
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Miss relevant projects that use different terminology
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Manually cross-reference and de-duplicate results
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-red-400 mt-1">-</span>
                    Hours of work for incomplete coverage
                  </li>
                </ul>
              </div>

              {/* The Solution */}
              <div className="bg-[#E07A5F]/5 rounded-2xl p-6 border border-[#E07A5F]/20">
                <div className="flex items-center gap-2 mb-4">
                  <Check className="w-5 h-5 text-[#E07A5F]" />
                  <h3 className="font-semibold text-gray-900">With granted.bio</h3>
                </div>
                <ul className="space-y-3 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    One search across all 4 databases
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    Natural language - ask what you mean
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    AI understands concepts, not just words
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    Finds related projects using different terminology
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    Results ranked by semantic relevance
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#E07A5F] mt-1">+</span>
                    Complete picture in minutes
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* What You Can Search */}
        <section className="py-16 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-4">
              Everything you need, connected
            </h2>
            <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
              Four essential databases unified under one semantic search.
              Understand who's funded, what's patented, what's published, and what's in trials.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-sm">NIH</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">NIH RePORTER</h3>
                    <p className="text-xs text-gray-500">129K projects indexed</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Active and historical NIH grants. See who's funded, how much, by which institute,
                  and track funding trajectories over time.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <span className="text-emerald-600 font-semibold text-sm">CT</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">ClinicalTrials.gov</h3>
                    <p className="text-xs text-gray-500">38K trials indexed</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Active and completed clinical trials. Phase distribution, sponsors,
                  enrollment status, and regulatory pathway insights.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <span className="text-purple-600 font-semibold text-sm">PM</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">PubMed</h3>
                    <p className="text-xs text-gray-500">203K publications indexed</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Scientific publications linked to funded research. Key investigators,
                  publication records, and citation impact.
                </p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                    <span className="text-amber-600 font-semibold text-sm">US</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">USPTO Patents</h3>
                    <p className="text-xs text-gray-500">46K patents indexed</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  Patent landscape and IP positions. Key holders, filing trends,
                  and freedom-to-operate considerations.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Who It's For */}
        <section className="py-20 px-6 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium mb-4">
                Built For You
              </span>
              <h2 className="text-3xl md:text-4xl font-semibold text-gray-900 mb-4">
                Research intelligence for every role
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Whether you're writing grants, evaluating investments, or building qualified leads,
                semantic search helps you find what matters faster.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Researchers */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <FlaskConical className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Researchers</h3>
                  </div>
                </div>
                <div className="p-5">
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      Find funded competitors for grant applications
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      Identify collaborators and mentors
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      Discover research gaps to pursue
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      Track funding trends by institute
                    </li>
                  </ul>
                </div>
              </div>

              {/* Investors */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Investors</h3>
                  </div>
                </div>
                <div className="p-5">
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      Validate markets through funding signals
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      Assess technical risk and maturity
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      Map IP landscape and competitors
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      Track clinical development progress
                    </li>
                  </ul>
                </div>
              </div>

              {/* Business Development */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <Briefcase className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Business Development</h3>
                  </div>
                </div>
                <div className="p-5">
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                      Build qualified lead lists
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                      Find partnership opportunities
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                      Monitor competitive landscape
                    </li>
                    <li className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                      Track key accounts and targets
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Intelligence Reports CTA */}
        <section className="py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 md:p-12 text-white">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-sm mb-4">
                    <FileText className="w-4 h-4" />
                    Intelligence Reports
                  </div>
                  <h2 className="text-2xl md:text-3xl font-semibold mb-4">
                    Need deeper analysis?
                  </h2>
                  <p className="text-gray-300 mb-6">
                    Get comprehensive intelligence reports on any topic. Our AI synthesizes
                    funding patterns, competitive dynamics, IP landscape, and clinical development
                    into actionable insights - in minutes, not weeks.
                  </p>
                  <Link
                    href="/reports"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
                  >
                    Learn About Reports
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
                <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                  <div className="text-center">
                    <div className="text-4xl font-semibold mb-2">$99</div>
                    <div className="text-gray-400 mb-4">per report</div>
                    <ul className="text-sm text-gray-300 space-y-2 text-left">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        Funding landscape analysis
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        Competitive intelligence
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        IP & patent analysis
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        Clinical development status
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 px-6 bg-gradient-to-br from-[#E07A5F] to-[#C96A4F]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">
              Ready to stop searching and start finding?
            </h2>
            <p className="text-white/80 mb-8">
              Get started free with 10 searches per month. No credit card required.
            </p>
            <Link
              href="#top"
              onClick={(e) => {
                e.preventDefault()
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#E07A5F] rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data from NIH RePORTER, ClinicalTrials.gov, USPTO & PubMed
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a href="mailto:hello@granted.bio" className="hover:text-gray-600 transition-colors">
              Contact
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
