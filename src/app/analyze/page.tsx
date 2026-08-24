'use client'

// The "create a new analysis" surface. This page is the entry point
// for generating a new analysis — logged-out visitors see the pitch
// (samples, pricing, sign-up gate); logged-in visitors see the same
// pitch content with a direct "Start Analysis" CTA that opens the
// GenerateReportDialog.
//
// Split from /reports on 2026-08-23 so nav semantics stay clean:
//   Search / Analyze          <- verbs (actions)
//   My Analyses / My Projects <- nouns (collections you own)
// See docs/POST_LAUNCH_BACKLOG and related discussion.

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Sparkles,
  Check,
  Loader2,
} from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { MarketingNav } from '@/components/MarketingNav'
import { SignUpModal } from '@/components/SignUpModal'
import { useAuth } from '@/contexts/AuthContext'
import { GenerateReportDialog } from '../reports/GenerateReportDialog'

export default function AnalyzePage() {
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

// ------------------------------------------------------------------
// Shared pitch content — same body for both authed and anon; only the
// wrapping chrome (AppLayout vs MarketingNav) and the CTA behavior
// (open dialog vs open sign-up modal) differ.
// ------------------------------------------------------------------

interface PitchContentProps {
  primaryLabel: string
  onPrimary: () => void
}

function PitchContent({ primaryLabel, onPrimary }: PitchContentProps) {
  return (
    <>
      {/* Hero — short intro, matches the /reports landing that existed
          before the analyze/reports split. */}
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
              onClick={onPrimary}
              className="inline-flex items-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
            >
              {primaryLabel}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs uppercase tracking-wider text-gray-400 mt-6">
            Data sources: NIH RePORTER · ClinicalTrials.gov · USPTO · PubMed
          </p>
        </div>
      </section>

      {/* Pricing card — same $199 card the /reports landing used. */}
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
              onClick={onPrimary}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
            >
              {primaryLabel}
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
    </>
  )
}

// ------------------------------------------------------------------
// Anon variant — pitch + SignUpModal on CTA. Wrapped in MarketingNav
// so the marketing chrome (Home / Samples / Analyses / Pricing) is
// present for someone who navigated in from a marketing surface.
// ------------------------------------------------------------------

function AnonAnalyze() {
  const [signUpOpen, setSignUpOpen] = useState<
    null | { title?: string; description?: string }
  >(null)

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main>
        <PitchContent
          primaryLabel="Get Started Free"
          onPrimary={() =>
            setSignUpOpen({
              title: 'Create a free account to start',
              description:
                "A free account is required to generate an analysis — it ties the analysis to your login so you can drill into every linked record for 3 months. Signing up takes a few seconds.",
            })
          }
        />

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

// ------------------------------------------------------------------
// Authed variant — same pitch, CTA opens the topic-picker dialog.
// Wrapped in AppLayout so the platform sidebar is present.
// ------------------------------------------------------------------

function AuthedAnalyze() {
  // Support the in-platform "Generate the intelligence report" CTA
  // from /chat by auto-opening the dialog when both params are
  // present. Also preserved as a redirect target from legacy
  // /reports?topic=&generate=1 URLs.
  const searchParams = useSearchParams()
  const inboundTopic = searchParams.get('topic')?.trim() || null
  const shouldAutoGenerate = searchParams.get('generate') === '1'

  const [showDialog, setShowDialog] = useState(
    Boolean(shouldAutoGenerate && inboundTopic)
  )
  const [presetTopic, setPresetTopic] = useState<string | null>(
    shouldAutoGenerate ? inboundTopic : null
  )
  const { profile, isAdmin, refetchProfile } = useAuth()

  // Same beta-cap gating as the old /reports dashboard used for its
  // "New Analysis" button — beta users at the cap can't open the
  // dialog. Show the empty pitch page state instead of the CTA when
  // they hit the ceiling.
  const isActiveBeta =
    profile?.tier === 'beta' &&
    !!profile.betaExpiresAt &&
    new Date(profile.betaExpiresAt) > new Date()
  const BETA_REPORT_CAP = 3
  const reportsUsed = profile?.reportsGenerated ?? 0
  const betaCapReached = isActiveBeta && reportsUsed >= BETA_REPORT_CAP
  const canBypassPayment = isAdmin || (isActiveBeta && !betaCapReached)

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <PitchContent
          primaryLabel={
            betaCapReached
              ? 'Beta limit reached'
              : canBypassPayment
                ? 'Start Analysis'
                : 'Start Analysis — $199'
          }
          onPrimary={() => {
            if (betaCapReached) return
            setShowDialog(true)
          }}
        />
      </div>

      {showDialog && (
        <GenerateReportDialog
          onClose={() => {
            setShowDialog(false)
            // Clear the preset so reopening doesn't re-inject a stale
            // topic from the URL after the user cancels.
            setPresetTopic(null)
          }}
          onGenerated={() => {
            setShowDialog(false)
            // Refresh the global profile so the beta counter ticks up
            // immediately in the sidebar / progress banner on /reports.
            refetchProfile()
          }}
          initialTopic={presetTopic ?? undefined}
        />
      )}
    </AppLayout>
  )
}
