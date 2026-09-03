'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, AlertCircle, Loader2, RefreshCw, Sparkles, X, ArrowRight, Share2, Printer } from 'lucide-react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MarkdownRenderer } from './MarkdownRenderer'
import { pickSections, extractScopeWarning, DASHBOARD_SECTIONS, extractSurprisingHeadlines } from './section-utils'
import { DashboardTiles } from './DashboardTiles'
import { SectionLabel } from './SectionLabel'
import { ShareAnalysisDialog } from './ShareAnalysisDialog'
import { useReportView } from './ReportViewContext'

interface FundingByYear {
  year: number
  funding: number
  projects: number
  isPartial?: boolean
}

interface CategoryData {
  category: string
  projects: number
  funding: number
}

interface FundingStats {
  total: number
  projectCount: number
  orgCount: number
  piCount: number
  byYear: FundingByYear[]
  byCategory: CategoryData[]
  byOrg: Array<{ org: string; projects: number; funding: number }>
}

interface TrialsAgentOutput {
  items: unknown[]
  byPhase: Record<string, number>
  byStatus: Record<string, number>
}

interface AgentOutputs {
  projects: unknown
  trials: TrialsAgentOutput
  patents: unknown
  publications: unknown
  market: unknown
}

interface Report {
  id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  status: 'generating' | 'complete' | 'failed'
  markdown_content: string | null
  executive_summary: string | null
  project_count: number | null
  data_limited: boolean
  error_message: string | null
  created_at: string
  updated_at: string
  // Chart data
  funding_stats: FundingStats | null
  agent_outputs: AgentOutputs | null
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  // Format in UTC so the header date matches the markdown "Generated:"
  // line, which is also produced in UTC. Without timeZone:'UTC' the
  // header renders in the viewer's local timezone and can disagree
  // with the markdown by a day for viewers whose local offset places
  // the created_at moment on the other side of midnight from UTC.
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { basePath, isShared, shareToken, isPublicSample } = useReportView()
  // Owner affordances (Share/Refine/Refresh) are hidden for both
  // share recipients AND public-sample visitors — neither is the
  // owner of the report. Print stays available in every mode.
  const showOwnerAffordances = !isShared && !isPublicSample
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [refreshAvailable, setRefreshAvailable] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false)

  // Retry assistant state
  const [retryAvailable, setRetryAvailable] = useState(false)
  type RetryStep = 'feedback' | 'analyzing' | 'choose' | 'generating'
  const [retryStep, setRetryStep] = useState<RetryStep | null>(null)
  type RetryFeedbackCategory =
    | 'projects_wrong'
    | 'too_narrow'
    | 'too_broad'
    | 'missed_aspect'
    | 'wrong_field'
  const [feedbackCategory, setFeedbackCategory] = useState<RetryFeedbackCategory | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  interface RetryProposal {
    label: string
    semanticQuery: string
    keywordQuery: string
    rationale: string
  }
  const [proposals, setProposals] = useState<RetryProposal[]>([])
  const [feedbackId, setFeedbackId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport()
  }, [id])

  // Poll while generating
  useEffect(() => {
    if (!report || report.status !== 'generating') return

    const interval = setInterval(fetchReport, 5000)
    return () => clearInterval(interval)
  }, [report?.status])

  const fetchReport = async () => {
    try {
      // In share mode append ?shareToken=X so the API route can
      // validate the token and hydrate via admin client without a
      // user session. shareToken comes from the layout-injected
      // ReportViewContext, which the middleware populates.
      const url = shareToken
        ? `/api/reports/${id}?shareToken=${encodeURIComponent(shareToken)}`
        : `/api/reports/${id}`
      const response = await fetch(url)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch report')
      }

      setReport(data.report)
      setRefreshAvailable(Boolean(data.refreshAvailable))
      setRetryAvailable(Boolean(data.retryAvailable))
    } catch (e) {
      console.error('Error fetching report:', e)
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  // Refresh consumes the bound refresh entitlement and regenerates the
  // same topic + interpretation against current NIH data. The original
  // report stays untouched; the new report is created as a fresh row and
  // we route the user to it so they see generation progress.
  //
  // Gated behind a confirm modal because the entitlement is one-shot —
  // once spent, the user has to buy a new report to refresh again.
  const refreshReport = async () => {
    if (!report || refreshing) return
    setShowRefreshConfirm(false)
    setRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetch(`/api/reports/${id}/refresh`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh report')
      }

      // Route to the new report so the user sees the generation progress
      // page immediately.
      router.push(`/reports/${data.report_id}`)
    } catch (e) {
      console.error('Error refreshing report:', e)
      setRefreshError(e instanceof Error ? e.message : 'Failed to refresh report')
      setRefreshing(false)
    }
  }

  // Smart timing nudge: surface the "new data may be available" banner if
  // the report is older than 60 days AND a refresh credit is still
  // available. NIH RePORTER updates monthly so 60+ days is virtually
  // guaranteed to have new data on most topics.
  const reportAgeDays = report?.created_at
    ? Math.floor((Date.now() - new Date(report.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0
  const showRefreshNudge = refreshAvailable && reportAgeDays >= 60

  // Retry-assistant flow handlers
  const openRetryModal = () => {
    setRetryStep('feedback')
    setFeedbackCategory(null)
    setFeedbackText('')
    setProposals([])
    setFeedbackId(null)
    setRetryError(null)
  }

  const closeRetryModal = () => {
    if (retryStep === 'analyzing' || retryStep === 'generating') return
    setRetryStep(null)
    setRetryError(null)
  }

  const submitFeedback = async () => {
    if (!feedbackCategory) return
    setRetryStep('analyzing')
    setRetryError(null)

    try {
      const response = await fetch(`/api/reports/${id}/retry/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedbackCategory,
          feedbackText: feedbackText.trim() || null,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to refine')

      setProposals(data.proposals ?? [])
      setFeedbackId(data.feedback_id ?? null)
      setRetryStep('choose')
    } catch (e) {
      console.error('Error refining retry:', e)
      setRetryError(e instanceof Error ? e.message : 'Failed to refine')
      setRetryStep('feedback')
    }
  }

  const chooseProposalAndGenerate = async (proposal: typeof proposals[number]) => {
    setRetryStep('generating')
    setRetryError(null)

    try {
      const response = await fetch(`/api/reports/${id}/retry/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback_id: feedbackId,
          chosen_interpretation: proposal,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to generate retry')

      router.push(`/reports/${data.report_id}`)
    } catch (e) {
      console.error('Error generating retry:', e)
      setRetryError(e instanceof Error ? e.message : 'Failed to generate retry')
      setRetryStep('choose')
    }
  }

  const FEEDBACK_OPTIONS: { value: RetryFeedbackCategory; label: string }[] = [
    { value: 'projects_wrong', label: "The projects weren't quite what I was looking for" },
    { value: 'too_narrow', label: 'Too narrow — missed adjacent areas' },
    { value: 'too_broad', label: 'Too broad — too much off-topic material' },
    { value: 'missed_aspect', label: 'Missed a specific aspect I care about' },
    { value: 'wrong_field', label: 'Wrong research field entirely' },
  ]

  if (loading) {
    // Renders inside the portal layout's <main>; no outer wrapper.
    return (
      <div className="min-h-full flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !report) {
    // Portal layout (from src/app/reports/[id]/layout.tsx) provides the
    // sidebar shell + main container; page-level render just fills
    // the main area with an error card.
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-900 mb-2">
            {error || 'Report not found'}
          </h2>
          <Link
            href="/reports"
            className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
          >
            Go back to analyses
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Header — 'Generated' + 'projects analyzed' bar. Portal layout
          owns the outer chrome (sidebar + main); this component only
          renders inside <main>. Sticky within the scrollable main so
          the metrics + actions stay visible when the reader scrolls
          through the narrative body. */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div />
            <Breadcrumbs
              items={[
                { label: 'Analyses', href: '/reports' },
                { label: report.title.length > 30 ? report.title.slice(0, 30) + '...' : report.title },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {/* Report Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-[#FDF2EF] rounded-lg">
                <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 mb-1">
                  {report.title}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Generated {formatDate(report.created_at)}</span>
                  {report.project_count !== null && (
                    <>
                      <span>•</span>
                      <span>{report.project_count} projects analyzed</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {report.status === 'complete' && report.markdown_content && (
              <div className="flex items-center gap-3 text-xs print:hidden">
                {/* Owner-only actions — hidden for both share recipients
                    and public-sample visitors. Everyone can Print. */}
                {showOwnerAffordances && (
                  <>
                    <button
                      onClick={() => setShowShareDialog(true)}
                      title="Share this analysis with a colleague — no login required for them to view."
                      className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Share
                    </button>
                    <span className="text-gray-300">|</span>
                    {retryAvailable && (
                      <>
                        <button
                          onClick={openRetryModal}
                          title="Not what you expected? Refine your search and regenerate, free."
                          className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Refine
                        </button>
                        <span className="text-gray-300">|</span>
                      </>
                    )}
                    {refreshAvailable && (
                      <>
                        <button
                          onClick={() => setShowRefreshConfirm(true)}
                          disabled={refreshing}
                          title="Re-synthesize this report against current NIH data. Uses your included refresh."
                          className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors disabled:opacity-50"
                        >
                          {refreshing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
                          )}
                          {refreshing ? 'Starting...' : 'Refresh'}
                        </button>
                        <span className="text-gray-300">|</span>
                      </>
                    )}
                  </>
                )}
                <button
                  onClick={() => window.print()}
                  title="Print this page. Use 'Save as PDF' in the print dialog for a PDF."
                  className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Print
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Smart timing nudge: report is >60 days old and the included
            refresh is still available. NIH RePORTER updates monthly so
            60+ days is virtually guaranteed to have new data.
            Owner-only — recipients can't refresh someone else's report. */}
        {showRefreshNudge && showOwnerAffordances && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
            <RefreshCw className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-900">
                This report is {reportAgeDays} days old. New NIH data has likely been added since.
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Use your included refresh to re-synthesize on current data, free.
              </p>
            </div>
            <button
              onClick={() => setShowRefreshConfirm(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.5} />
              )}
              {refreshing ? 'Starting...' : 'Refresh now'}
            </button>
          </div>
        )}

        {refreshError && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-6 text-sm text-rose-800">
            {refreshError}
          </div>
        )}

        {/* Report Content */}
        {report.status === 'generating' && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="relative inline-block mb-4">
              <FileText className="w-16 h-16 text-[#E07A5F]" strokeWidth={1.5} />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow">
                <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
              </div>
            </div>
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Generating Report...
            </h2>
            <p className="text-gray-500">
              Our AI agents are gathering and analyzing data. This page will
              automatically update when the report is ready.
            </p>
          </div>
        )}

        {report.status === 'failed' && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Report Generation Failed
            </h2>
            <p className="text-gray-500 mb-6">
              {report.error_message || 'An error occurred while generating the report.'}
            </p>
            {retryAvailable ? (
              <div className="space-y-3">
                <button
                  onClick={openRetryModal}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Refine your search and try again
                </button>
                <p className="text-xs text-gray-400">
                  Free retry included with this report. We&apos;ll help you reformulate.
                </p>
              </div>
            ) : (
              <Link
                href="/reports"
                className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
              >
                Go back to reports
              </Link>
            )}
          </div>
        )}

        {report.status === 'complete' && report.markdown_content && (() => {
          // Dashboard layout (2026-08-12 iteration):
          //   1. Scope-warning banner (when scope-collapse fired)
          //   2. Metric tiles — 6 dimensions, click-through to Data
          //   3. What Surprised Us teaser — top 3 headlines, link to
          //      the full /surprising Analysis page
          //   4. Executive Summary + Next Steps (combined narrative)
          //
          // Surprising sits between tiles and the exec-summary block
          // so the "non-obvious findings" hit reads immediately after
          // the "here's the scope" tiles and before the paragraphs.
          const scopeWarning = extractScopeWarning(report.markdown_content)
          const dashboardMd = pickSections(report.markdown_content, DASHBOARD_SECTIONS)
          const surprisingHeadlines = extractSurprisingHeadlines(report.markdown_content, 3)
          return (
            <>
              {scopeWarning && (
                <div id="scope-warning" className="mb-6">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <MarkdownRenderer content={scopeWarning} compact />
                  </div>
                </div>
              )}

              <section className="mb-6">
                <SectionLabel className="mb-3 px-1">Sample Scope</SectionLabel>
                <DashboardTiles
                  reportId={report.id}
                  projectCount={report.project_count ?? (report.funding_stats?.projectCount ?? 0)}
                  fundingTotal={report.funding_stats?.total ?? 0}
                  fundingByYear={report.funding_stats?.byYear ?? []}
                  // Trials/patents/publications counts read from the
                  // top-level report columns (same source the sidebar
                  // uses) so dashboard tiles + sidebar always agree.
                  trialsCount={((report as { clinical_trials?: unknown[] }).clinical_trials ?? []).length}
                  trialsByPhase={report.agent_outputs?.trials?.byPhase}
                  patentsCount={((report as { patents?: unknown[] }).patents ?? []).length}
                  publicationsCount={((report as { publications?: unknown[] }).publications ?? []).length}
                  organizationsCount={report.funding_stats?.orgCount ?? 0}
                  researchersCount={report.funding_stats?.piCount ?? 0}
                />
              </section>

              {surprisingHeadlines.length > 0 && (
                <Link
                  href={`${basePath}/surprising`}
                  className="group block bg-white rounded-lg border border-gray-200 hover:border-[#E07A5F] hover:shadow-sm transition-all px-6 py-5 mb-6"
                >
                  <div className="flex items-center justify-between mb-3">
                    <SectionLabel className="mb-0">What Surprised Us</SectionLabel>
                    <div className="text-[11px] font-medium text-gray-400 group-hover:text-[#E07A5F] uppercase tracking-wider transition-colors">
                      See all {surprisingHeadlines.length}+ &rarr;
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {surprisingHeadlines.map((h) => (
                      <li key={h.index} className="flex items-start gap-3 text-[14px] text-gray-700 leading-snug">
                        <span className="flex-shrink-0 text-gray-400 font-medium tabular-nums mt-px">
                          {h.index}.
                        </span>
                        <span>{h.headline}</span>
                      </li>
                    ))}
                  </ul>
                </Link>
              )}

              {dashboardMd && (
                <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
                  <SectionLabel>Executive Summary &amp; Next Steps</SectionLabel>
                  <div id="report-content" className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                  <MarkdownRenderer
                    content={dashboardMd}
                    compact
                    chartData={{
                      fundingByYear: report.funding_stats?.byYear,
                      categories: report.funding_stats?.byCategory,
                      trialsByPhase: report.agent_outputs?.trials?.byPhase,
                      whiteSpace: (report.agent_outputs as { whiteSpace?: unknown })?.whiteSpace as never,
                    }}
                  />
                  </div>
                </section>
              )}
            </>
          )
        })()}
      </main>

      {/* Refresh confirm modal — refresh is a one-shot entitlement
          bound to this report, so the user gets a clear go / no-go
          before we burn it. Click-outside cancels (no consume). */}
      {showRefreshConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowRefreshConfirm(false)
          }}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
            <div className="flex items-start justify-between p-6 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#E07A5F] font-medium mb-1">
                  <RefreshCw className="w-3.5 h-3.5" />
                  Use your included refresh?
                </div>
                <h2 className="text-lg font-semibold text-gray-900">
                  This is your one free refresh.
                </h2>
              </div>
              <button
                onClick={() => setShowRefreshConfirm(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                We&apos;ll re-synthesize this report against current NIH data using
                the same topic and interpretation. Your original stays untouched
                — a new report is created.
              </p>
              <p className="text-sm text-gray-600 leading-relaxed">
                After this, refreshing again will require buying a new report.
              </p>

              <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg p-3">
                Something look off in the report? Email{' '}
                <a
                  href="mailto:hello@granted.bio"
                  className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
                >
                  hello@granted.bio
                </a>{' '}
                first — if it&apos;s a bug on our side we can usually fix it without
                using your refresh.
              </p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowRefreshConfirm(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={refreshReport}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Use my refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Retry assistant modal — captures dissatisfaction feedback, asks
          Claude for three reformulated interpretations, shows the picker,
          consumes the retry credit on generate. The "analyzing" and
          "generating" steps block close because cancelling mid-flight
          would orphan a Claude call (and on generating, a new report). */}
      {retryStep !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRetryModal()
          }}
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b border-gray-100">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#E07A5F] font-medium mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Refine & Regenerate
                </div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {retryStep === 'feedback' && "What didn't work?"}
                  {retryStep === 'analyzing' && 'Analyzing your feedback...'}
                  {retryStep === 'choose' && 'Pick a refined interpretation'}
                  {retryStep === 'generating' && 'Starting your new report...'}
                </h2>
              </div>
              {(retryStep === 'feedback' || retryStep === 'choose') && (
                <button
                  onClick={closeRetryModal}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <div className="p-6">
              {retryStep === 'feedback' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Tell us what didn&apos;t work and our analysis engine will reformulate the search.
                    Free — uses your included retry, doesn&apos;t cost a new report.
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 rounded-lg p-3">
                    Spotted a bug or something clearly wrong? Email{' '}
                    <a
                      href="mailto:hello@granted.bio"
                      className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
                    >
                      hello@granted.bio
                    </a>{' '}
                    first — if it&apos;s a fix on our side we can usually handle it
                    without using your retry.
                  </p>
                  <div className="space-y-2">
                    {FEEDBACK_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          feedbackCategory === opt.value
                            ? 'border-[#E07A5F] bg-[#FDF2EF]'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="feedback-category"
                          value={opt.value}
                          checked={feedbackCategory === opt.value}
                          onChange={() => setFeedbackCategory(opt.value)}
                          className="mt-0.5 text-[#E07A5F] focus:ring-[#E07A5F]"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Tell us more (optional)
                    </label>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      rows={3}
                      placeholder="e.g. I was looking for methylation-based detection, not fragmentomics."
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent resize-none"
                    />
                  </div>
                  {retryError && (
                    <p className="text-sm text-rose-600">{retryError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={closeRetryModal}
                      className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitFeedback}
                      disabled={!feedbackCategory}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {retryStep === 'analyzing' && (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mx-auto mb-4" />
                  <p className="text-sm text-gray-600">
                    Our analysis engine is reviewing your report and proposing three refined interpretations.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">This takes about 10 seconds.</p>
                </div>
              )}

              {retryStep === 'choose' && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Based on what you told us, here are three ways to re-run this. Pick one
                    and we&apos;ll regenerate — your retry is included.
                  </p>
                  <div className="space-y-3">
                    {proposals.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => chooseProposalAndGenerate(p)}
                        className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-[#E07A5F] hover:bg-[#FDF2EF]/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 text-sm mb-1">
                              {p.label}
                            </div>
                            <div className="text-xs text-gray-500 italic mb-2">
                              &ldquo;{p.semanticQuery}&rdquo;
                            </div>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {p.keywordQuery
                                .split('|')
                                .slice(0, 8)
                                .map((kw, ki) => (
                                  <span
                                    key={ki}
                                    className="inline-block px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded"
                                  >
                                    {kw.trim()}
                                  </span>
                                ))}
                            </div>
                            <p className="text-xs text-gray-600">{p.rationale}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                        </div>
                      </button>
                    ))}
                  </div>
                  {retryError && (
                    <p className="text-sm text-rose-600">{retryError}</p>
                  )}
                  <div className="flex justify-between items-center pt-2">
                    <button
                      onClick={() => setRetryStep('feedback')}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      ← Back to feedback
                    </button>
                    <button
                      onClick={closeRetryModal}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {retryStep === 'generating' && (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mx-auto mb-4" />
                  <p className="text-sm text-gray-600">
                    Generating your refined report. We&apos;ll route you to it in a moment.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showShareDialog && report && (
        <ShareAnalysisDialog
          reportId={report.id}
          reportTopic={report.topic}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  )
}
