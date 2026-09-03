'use client'

// The "create a new analysis" surface — logged-in only.
//
// Logged-in visitors get a focused, platform-native topic-picker:
// header + short prompt + big topic input that opens the
// GenerateReportDialog with the topic pre-filled. No pitch, no
// pricing card — an authed user is already sold; they need to act.
//
// Anon visitors redirect to `/` (the landing page owns the pitch).
// Prior to 2026-09-03 this page had a full anon marketing variant
// (hero + pricing card + sign-up modal), but every element
// duplicated content on /, /pricing, or /samples. Removed for
// clarity; the sign-up flow (GenerateReportCTA → SignUpModal →
// post-auth redirect to /analyze) still lands users here after
// signing up.
//
// Split from /reports on 2026-08-23 so nav semantics stay clean:
//   Search / Analyze          <- verbs (actions)
//   My Analyses / My Projects <- nouns (collections you own)

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Sparkles,
  Check,
  Loader2,
  FlaskConical,
  TrendingUp,
} from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { GenerateReportDialog } from '../reports/GenerateReportDialog'

function AnalyzePageInner() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  // Anon → send to the landing page. The GenerateReportCTA flow
  // brings authed users back here after sign-up automatically, so
  // this redirect only fires for direct-URL anon hits (bookmarks,
  // external links, session expiry).
  useEffect(() => {
    if (!isLoading && !user) router.replace('/')
  }, [isLoading, user, router])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return <AuthedAnalyze />
}

// Wrapped in Suspense because AuthedAnalyze calls useSearchParams()
// to pick up the ?topic=&generate=1 auto-open params from /chat.
// Next.js requires the boundary so the page can still prerender.
export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      }
    >
      <AnalyzePageInner />
    </Suspense>
  )
}

function AuthedAnalyze() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inboundTopic = searchParams.get('topic')?.trim() || null
  const shouldAutoGenerate = searchParams.get('generate') === '1'
  // Pre-applied Stripe promo code from a marketing URL — e.g.,
  // /analyze?promo=LAUNCH20 pre-applies the LAUNCH20 coupon at
  // checkout so the recipient doesn't have to type it. Codes can
  // still be entered manually at Stripe checkout when this is absent.
  const inboundPromoCode = searchParams.get('promo')?.trim().toUpperCase() || null

  const { profile, isAdmin, refetchProfile } = useAuth()

  const [topic, setTopic] = useState(inboundTopic ?? '')
  const [showDialog, setShowDialog] = useState(
    Boolean(shouldAutoGenerate && inboundTopic)
  )
  const [presetTopic, setPresetTopic] = useState<string | null>(
    shouldAutoGenerate ? inboundTopic : null
  )
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    // Autofocus the topic input on mount — the whole page's job is to
    // capture a topic, so cursor-in-field beats one extra click.
    textareaRef.current?.focus()
  }, [])

  const isActiveBeta =
    profile?.tier === 'beta' &&
    !!profile.betaExpiresAt &&
    new Date(profile.betaExpiresAt) > new Date()
  const BETA_REPORT_CAP = 3
  const reportsUsed = profile?.reportsGenerated ?? 0
  const reportsRemaining = Math.max(0, BETA_REPORT_CAP - reportsUsed)
  const betaCapReached = isActiveBeta && reportsUsed >= BETA_REPORT_CAP
  const daysRemaining = profile?.betaExpiresAt
    ? Math.max(0, Math.ceil(
        (new Date(profile.betaExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      ))
    : null
  const canBypassPayment = isAdmin || (isActiveBeta && !betaCapReached)

  const handleContinue = () => {
    if (betaCapReached) return
    const trimmed = topic.trim()
    if (!trimmed) return
    setPresetTopic(trimmed)
    setShowDialog(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits — familiar shortcut for anyone who's
    // typed into a Slack/GitHub/etc composer. Plain Enter stays free
    // for multi-line topic phrasing.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleContinue()
    }
  }

  const ctaLabel = betaCapReached
    ? 'Beta limit reached'
    : canBypassPayment
      ? 'Continue'
      : 'Continue — $199'

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-8">
          {/* Page header — matches the /reports "My Analyses" header
              pattern (icon + title, no marketing copy). */}
          <div className="flex items-center gap-3 mb-6">
            <Sparkles className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
            <h1 className="text-2xl font-semibold text-gray-900">Analyze</h1>
          </div>

          {/* Beta progress banner (only for active beta users) — same
              styling as the /reports banner so state reads
              consistently across the two pages. */}
          {isActiveBeta && (
            <div className={`mb-6 rounded-lg border px-4 py-3 ${
              betaCapReached
                ? 'bg-gray-50 border-gray-200'
                : reportsRemaining === 1
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-violet-50 border-violet-200'
            }`}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                    betaCapReached ? 'bg-gray-200 text-gray-700' : 'bg-violet-100 text-violet-700'
                  }`}>
                    Beta
                  </span>
                  <span className="text-sm text-gray-700">
                    {betaCapReached ? (
                      <>You&apos;ve used all <strong>{BETA_REPORT_CAP} of {BETA_REPORT_CAP}</strong> beta analyses.</>
                    ) : (
                      <>Analysis <strong>{reportsUsed + 1} of {BETA_REPORT_CAP}</strong> &middot; <strong>{reportsRemaining}</strong> remaining</>
                    )}
                  </span>
                </div>
                {daysRemaining !== null && !betaCapReached && (
                  <span className="text-xs text-gray-500">
                    Beta access expires in <strong>{daysRemaining} day{daysRemaining === 1 ? '' : 's'}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Topic-input card. Single-purpose surface — this is where
              the whole page's action lives. */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 sm:p-7">
            <label htmlFor="topic-input" className="block">
              <div className="text-base font-medium text-gray-900 mb-1.5">
                What do you want to analyze?
              </div>
              <div className="text-sm text-gray-500 mb-4">
                A therapeutic area, technology, indication, or research question.
                Be as specific or as broad as you like — we&apos;ll show you the
                match options before you commit.
              </div>
              <textarea
                id="topic-input"
                ref={textareaRef}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                placeholder="e.g. cell-free antibody engineering, radioligand therapy for prostate cancer, brain organoid electrophysiology"
                className="w-full px-3.5 py-3 text-[15px] text-gray-900 placeholder:text-gray-400 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20 resize-none leading-relaxed"
                disabled={betaCapReached}
              />
            </label>

            <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-gray-500">
                {canBypassPayment ? (
                  <>Free under your current tier. A few minutes to generate.</>
                ) : (
                  <>
                    <span className="text-gray-700 font-medium">$199</span> &middot; 3-month platform pass with one analysis included &middot; a few minutes to generate
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={handleContinue}
                disabled={betaCapReached || !topic.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
              >
                {ctaLabel}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Compact secondary row — persona hint + sample link. Keeps
              the page grounded but doesn't compete with the input. */}
          <div className="mt-6 flex items-center justify-between gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-4 text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5" strokeWidth={1.75} />
                Researcher
              </span>
              <span className="text-gray-300">/</span>
              <span className="inline-flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />
                Investor
              </span>
              <span className="text-xs text-gray-400">— choose in the next step</span>
            </div>
            <Link
              href="/samples"
              className="inline-flex items-center gap-1.5 text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Browse sample analyses
            </Link>
          </div>

          {/* Pre-applied promo code notice. Without this, a
              /analyze?promo=CODE recipient has no signal the discount
              is loaded until they hit Stripe checkout — surfaces it as
              a compact chip above the input. */}
          {inboundPromoCode && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-md text-xs text-emerald-800">
              <Check className="w-3.5 h-3.5" strokeWidth={2} />
              Promo code <span className="font-semibold">{inboundPromoCode}</span> will apply at checkout.
            </div>
          )}
        </div>
      </div>

      {showDialog && (
        <GenerateReportDialog
          onClose={() => {
            setShowDialog(false)
            setPresetTopic(null)
          }}
          onGenerated={() => {
            setShowDialog(false)
            // Once generation has kicked off in the background, route
            // the user to My Analyses. They'll see the new analysis
            // at the top with a "Generating..." status badge and the
            // page polls for status updates automatically. Without
            // this redirect the user is stranded on /analyze with no
            // signal that anything happened after clicking Close.
            refetchProfile()
            router.push('/reports')
          }}
          initialTopic={presetTopic ?? undefined}
          promoCode={inboundPromoCode ?? undefined}
        />
      )}
    </AppLayout>
  )
}
