'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  FileText,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  CheckCircle,
  Check,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { MarketingNav } from '@/components/MarketingNav'
import { SignUpModal } from '@/components/SignUpModal'
import { NameCapturePrompt } from '@/components/NameCapturePrompt'
import { GenerateReportDialog } from './GenerateReportDialog'
import { useAuth } from '@/contexts/AuthContext'
import { fetchWithRetry } from '@/lib/retry'

interface Report {
  id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  status: 'generating' | 'complete' | 'failed'
  progress_stage: 'searching_projects' | 'gathering_data' | 'aggregating' | 'synthesizing' | null
  project_count: number | null
  data_limited: boolean
  created_at: string
  updated_at: string
}

// Logged-out /reports — per LANDING_AND_CREDITS_PLAN.md §7. Title +
// sample link + pricing card + CTA. No mid-funnel loss of conversion:
// the marketing header from MarketingNav stays consistent with the home
// page, and the page is intentionally lean (the home page is where we
// do the long-form pitch).
function ReportsLanding() {
  const [signUpOpen, setSignUpOpen] = useState<
    null | { title?: string; description?: string }
  >(null)

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main>
        {/* Hero — short, since the home page already does the heavy
            lifting. The visitor landed here on intent. */}
        <section className="py-16 md:py-20 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl md:text-5xl font-semibold tracking-tight text-gray-900 mb-5">
              Generate a complete intelligence report on any topic.
            </h1>
            <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
              NIH funding, clinical trials, patents, and publications, synthesized
              into strategic narrative — generated in two minutes, with access to
              drill into every linked record for three months.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/sample/liquid-biopsy"
                className="inline-flex items-center gap-2 px-5 py-3 border border-gray-200 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[#E07A5F]" />
                See a Sample Report
              </Link>
              <button
                type="button"
                onClick={() =>
                  setSignUpOpen({
                    title: 'Create a free account to start',
                    description:
                      "A free account is required to generate a report — it ties the report to your login so you can drill into every linked record for 3 months. Signing up takes a few seconds.",
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

        {/* Pricing card — matches the home page §5 card so the
            conversion language is consistent across surfaces. */}
        <section className="py-12 px-6 bg-white border-y border-gray-100">
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
              <div className="text-center mb-6">
                <div className="text-4xl font-semibold text-gray-900">$199</div>
                <div className="text-gray-500 text-sm mt-1">per report</div>
              </div>
              <ul className="space-y-3 text-sm text-gray-700 mb-6">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Complete intelligence report (PDF + web)
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
                      'A free account is required so the report ties to your login and you can drill into every linked record during the 3-month window. Signing up takes a few seconds.',
                  })
                }
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
              >
                Buy a Report
                <ArrowRight className="w-4 h-4" />
              </button>
              <p className="text-center text-xs text-gray-500 mt-4">
                Need 5+ reports?{' '}
                <Link href="/contact" className="text-[#E07A5F] hover:text-[#C96A4F] underline">
                  Talk to us about volume.
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Free account positioning — same §6 framing as home. Keeps
            the soft path open for visitors not ready to buy. */}
        <section className="py-16 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              Not ready to commit? Browse the data first.
            </h2>
            <p className="text-gray-600 mb-6">
              A free account lets you search every project, trial, patent, and
              publication in our database. Verify your topic has signal before
              you buy the report.
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
        redirect="/reports"
        title={signUpOpen?.title}
        description={signUpOpen?.description}
      />
    </div>
  )
}

// Dashboard for authenticated users
function ReportsDashboard() {
  // Inbound query params from in-platform CTAs (e.g., the /chat inline
  // "Generate the intelligence report" prompt). Auto-opens the dialog
  // with the topic preloaded when both ?topic=... and ?generate=1 are
  // present.
  const searchParams = useSearchParams()
  const inboundTopic = searchParams.get('topic')?.trim() || null
  const shouldAutoGenerate = searchParams.get('generate') === '1'

  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showGenerateDialog, setShowGenerateDialog] = useState(
    Boolean(shouldAutoGenerate && inboundTopic)
  )
  const [presetTopic, setPresetTopic] = useState<string | null>(
    shouldAutoGenerate ? inboundTopic : null
  )

  const { user, isAdmin, profile, refetchProfile } = useAuth()

  // Active beta = beta tier with non-expired window
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

  // Associates get expanded search but NOT free report generation —
  // they pay like regular users. Only admins and active beta users
  // (within the cap) bypass payment. See the matching check at
  // /api/reports for the server-side enforcement.
  const canBypassPayment = isAdmin || (isActiveBeta && !betaCapReached)

  useEffect(() => {
    fetchReports()
  }, [])

  // Poll for generating reports
  useEffect(() => {
    const generatingReports = reports.filter((r) => r.status === 'generating')
    if (generatingReports.length === 0) return

    const interval = setInterval(fetchReports, 5000)
    return () => clearInterval(interval)
  }, [reports])

  const fetchReports = async () => {
    try {
      const response = await fetchWithRetry(
        () => fetch('/api/reports'),
        { maxRetries: 2, initialDelayMs: 1000 }
      )
      const data = await response.json()
      if (data.reports) {
        setReports(data.reports)
      }
    } catch (e) {
      console.error('Error fetching reports:', e)
    } finally {
      setLoading(false)
    }
  }

  const deleteReport = async (id: string) => {
    setDeletingId(id)
    try {
      await fetchWithRetry(
        () => fetch(`/api/reports/${id}`, { method: 'DELETE' }),
        { maxRetries: 2, initialDelayMs: 500 }
      )
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      console.error('Error deleting report:', e)
    } finally {
      setDeletingId(null)
    }
  }

  const handleReportGenerated = () => {
    setShowGenerateDialog(false)
    fetchReports()
    // Refresh the global profile so the beta progress banner ticks up
    // (reportsGenerated comes from useAuth and is computed at fetch time).
    refetchProfile()
  }

  // Name capture gate. New users who arrive here via the
  // GenerateReportCTA modal flow have authenticated but haven't been
  // through the /chat welcome screen, so their profile.firstName is
  // still null. Block the dashboard until we've captured a name —
  // otherwise receipts, future emails, and any later personalization
  // will all be nameless. needsName mirrors the /chat check: user is
  // present, profile loaded, but firstName is missing.
  const needsName = !!user && profile !== null && !profile.firstName
  if (needsName) {
    return (
      <AppLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <NameCapturePrompt />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
              <h1 className="text-2xl font-semibold text-gray-900">My Reports</h1>
            </div>
            {betaCapReached ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-400 cursor-not-allowed">
                Beta limit reached
              </span>
            ) : (
              <button
                onClick={() => setShowGenerateDialog(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[#E07A5F] hover:bg-[#FDF2EF] rounded-lg transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                New Report
              </button>
            )}
          </div>

          {/* Beta progress banner */}
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
                      <>You&apos;ve used all <strong>{BETA_REPORT_CAP} of {BETA_REPORT_CAP}</strong> beta reports.</>
                    ) : (
                      <>Report <strong>{reportsUsed + 1} of {BETA_REPORT_CAP}</strong> &middot; <strong>{reportsRemaining}</strong> remaining</>
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

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="font-medium text-gray-900 mb-2">No reports yet</h3>
              <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
                Generate your first intelligence report to get comprehensive
                analysis on any life science topic.
              </p>
              <button
                onClick={() => setShowGenerateDialog(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors text-sm"
              >
                {canBypassPayment ? 'Generate Report' : 'Generate Report - $199'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                >
                  <Link
                    href={
                      report.status === 'complete'
                        ? `/reports/${report.id}`
                        : '#'
                    }
                    className={`flex-1 min-w-0 ${
                      report.status !== 'complete'
                        ? 'pointer-events-none'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-medium text-gray-900 leading-snug group-hover:text-[#E07A5F] transition-colors">
                        {report.title}
                      </h3>
                      <StatusBadge status={report.status} progressStage={report.progress_stage} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{formatDateTime(report.created_at)}</span>
                      {report.project_count !== null && (
                        <>
                          <span>-</span>
                          <span>{report.project_count} projects</span>
                        </>
                      )}
                      {report.data_limited && (
                        <>
                          <span>-</span>
                          <span className="text-amber-500">Limited data</span>
                        </>
                      )}
                    </div>
                    {report.status === 'failed' && (
                      // Failed reports leave the user uncertain whether
                      // they were charged. The atomic-claim webhook
                      // pattern means a failed generation does NOT
                      // consume a generation credit (the purchase row
                      // stays pending until the recovery cron picks it
                      // up). We surface that reassurance + a contact
                      // path here so the user isn't left wondering.
                      <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2.5 py-1.5">
                        Generation didn&apos;t complete. You haven&apos;t been
                        charged for this attempt. Email{' '}
                        <a
                          href="mailto:admin@granted.bio"
                          className="font-medium underline pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          admin@granted.bio
                        </a>{' '}
                        and we&apos;ll regenerate or refund.
                      </div>
                    )}
                  </Link>
                  <button
                    onClick={() => deleteReport(report.id)}
                    disabled={deletingId === report.id}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                    title="Delete report"
                  >
                    {deletingId === report.id ? (
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {showGenerateDialog && (
            <GenerateReportDialog
              onClose={() => {
                setShowGenerateDialog(false)
                // Clear the preset so reopening via "Generate New Report"
                // doesn't re-inject a stale topic from the URL.
                setPresetTopic(null)
              }}
              onGenerated={handleReportGenerated}
              initialTopic={presetTopic ?? undefined}
            />
          )}
        </div>
      </div>
    </AppLayout>
  )
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

const PROGRESS_LABELS: Record<string, string> = {
  searching_projects: 'Searching projects...',
  gathering_data: 'Gathering data...',
  aggregating: 'Analyzing...',
  synthesizing: 'Writing report...',
}

function StatusBadge({ status, progressStage }: { status: Report['status']; progressStage?: Report['progress_stage'] }) {
  if (status === 'generating') {
    const label = progressStage ? PROGRESS_LABELS[progressStage] || 'Generating...' : 'Generating...'
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        {label}
      </span>
    )
  }
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
        <CheckCircle className="w-3 h-3" />
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700">
      <AlertCircle className="w-3 h-3" />
      Failed
    </span>
  )
}

// Main component that decides which view to show.
// Uses AuthContext as the single source of truth — previously the page
// did its own /api/reports fetch and treated ANY error (including
// transient network blips during a Vercel redeploy) as logged-out,
// which would flip an authenticated visitor to the marketing landing.
export default function ReportsPage() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return user ? <ReportsDashboard /> : <ReportsLanding />
}
