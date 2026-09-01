'use client'

// The "create a new analysis" surface.
//
// - Logged-out visitors get the marketing pitch (hero + pricing +
//   sign-up) wrapped in MarketingNav.
// - Logged-in visitors get a focused, platform-native topic-picker:
//   header + short prompt + big topic input that opens the
//   GenerateReportDialog with the topic pre-filled. No pitch, no
//   pricing card — an authed user is already sold; they need to act.
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
import { MarketingNav } from '@/components/MarketingNav'
import { SignUpModal } from '@/components/SignUpModal'
import { useAuth } from '@/contexts/AuthContext'
import { GenerateReportDialog } from '../reports/GenerateReportDialog'

function AnalyzePageInner() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return user ? <AuthedAnalyze /> : <AnonAnalyze />
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

// ==================================================================
// Anon variant — pitch page for logged-out visitors. Kept as-is
// (marketing framing lives here for anyone who arrived from a public
// surface without a session).
// ==================================================================

function AnonAnalyze() {
  const [signUpOpen, setSignUpOpen] = useState<
    null | { title?: string; description?: string }
  >(null)

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main>
        <section className="py-16 md:py-20 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-gray-900 mb-5">
              Generate a complete intelligence analysis on any topic.
            </h1>
            <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
              NIH funding, clinical trials, patents, and publications, synthesized
              into strategic narrative — generated in two minutes, with access to
              drill into every linked record for three months.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/samples"
                className="inline-flex items-center gap-2 px-5 py-3 border border-gray-200 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[#E07A5F]" />
                See Sample Analyses
              </Link>
              <button
                type="button"
                onClick={() =>
                  setSignUpOpen({
                    title: 'Create a free account to start',
                    description:
                      "A free account is required to generate an analysis — it ties the analysis to your login so you can drill into every linked record for 3 months. Signing up takes a few seconds.",
                  })
                }
                className="inline-flex items-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mt-6">
              Data sources: NIH RePORTER · ClinicalTrials.gov · USPTO · PubMed
            </p>
          </div>
        </section>

        <section className="py-12 px-6 bg-white border-y border-gray-100">
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
              <div className="text-center mb-6">
                <div className="text-4xl font-semibold text-gray-900">$199</div>
                <div className="text-gray-500 text-sm mt-1">per analysis</div>
              </div>
              <ul className="space-y-3 text-sm text-gray-700 mb-6">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Complete intelligence analysis (web portal + PDF export)
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Full access to every linked project, trial, patent, publication
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  3 months of in-platform exploration from generation
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  One free refresh within 12 months
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Not what you expected? Refine and regenerate, free.
                </li>
              </ul>
              <button
                type="button"
                onClick={() =>
                  setSignUpOpen({
                    title: 'Create a free account to continue',
                    description:
                      'A free account is required so the analysis ties to your login and you can drill into every linked record during the 3-month window. Signing up takes a few seconds.',
                  })
                }
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-center text-xs text-gray-500 mt-4">
                Need 5+ analyses?{' '}
                <Link href="/contact" className="text-[#E07A5F] hover:text-[#C96A4F] underline">
                  Talk to us about volume.
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section className="py-16 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              Not ready to commit? Browse the data first.
            </h2>
            <p className="text-gray-600 mb-6">
              A free account lets you search every project, trial, patent, and
              publication in our database. Verify your topic has signal before
              you buy the analysis.
            </p>
            <button
              type="button"
              onClick={() => setSignUpOpen({})}
              className="inline-flex items-center gap-2 text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Create a Free Account
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-gray-400">
          <p>Data from NIH RePORTER, ClinicalTrials.gov, USPTO &amp; PubMed</p>
          <div className="flex items-center gap-6">
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

      <SignUpModal
        open={signUpOpen !== null}
        onClose={() => setSignUpOpen(null)}
        redirect="/analyze"
        title={signUpOpen?.title}
        description={signUpOpen?.description}
      />
    </div>
  )
}

// ==================================================================
// Authed variant — focused topic-picker page. No pitch, no pricing
// card, no marketing framing. Compact header + a single big input
// card. Submitting opens the GenerateReportDialog with the topic
// pre-filled so the interpret-topic preview flow runs unchanged.
// ==================================================================

function AuthedAnalyze() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inboundTopic = searchParams.get('topic')?.trim() || null
  const shouldAutoGenerate = searchParams.get('generate') === '1'

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
                  <>Free under your current tier. Two minutes to generate.</>
                ) : (
                  <>
                    <span className="text-gray-700 font-medium">$199</span> per analysis &middot; free refresh included &middot; ~2 min to generate
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
        />
      )}
    </AppLayout>
  )
}
