'use client'

// "My Analyses" — list of prior analyses owned by the signed-in user.
// The create surface (pitch + topic picker + generate dialog) lives at
// /analyze; this page is intentionally list-only. Split from a
// combined page on 2026-08-23 so nav semantics stay clean:
//   Search / Analyze          <- verbs
//   My Analyses / My Projects <- nouns
// Logged-out visitors get redirected to /analyze, which handles the
// marketing pitch + sign-up flow.

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FileText,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  CheckCircle,
} from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { NameCapturePrompt } from '@/components/NameCapturePrompt'
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

function ReportsDashboard() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { user, profile } = useAuth()

  // Active beta = beta tier with non-expired window. Retained here
  // purely for the progress banner; the "start analysis" action itself
  // lives on /analyze now.
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

  useEffect(() => {
    fetchReports()
  }, [])

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

  // Name capture gate. New users who arrive here via the
  // GenerateReportCTA modal flow have authenticated but haven't been
  // through the /chat welcome screen, so their profile.firstName is
  // still null. Block the dashboard until we've captured a name.
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
              <h1 className="text-2xl font-semibold text-gray-900">My Analyses</h1>
            </div>
            {betaCapReached ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-400 cursor-not-allowed">
                Beta limit reached
              </span>
            ) : (
              <Link
                href="/analyze"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[#E07A5F] hover:bg-[#FDF2EF] rounded-lg transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" strokeWidth={1.5} />
                New Analysis
              </Link>
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
              <h3 className="font-medium text-gray-900 mb-2">No analyses yet</h3>
              <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
                Generate your first intelligence analysis to get comprehensive
                coverage on any life science topic.
              </p>
              <Link
                href="/analyze"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors text-sm"
              >
                Start an Analysis
                <Plus className="w-4 h-4" />
              </Link>
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

// Main entrypoint. Logged-out visitors and any inbound with the legacy
// ?topic=&generate=1 params get forwarded to /analyze, which owns the
// pitch + generate flow. AuthContext is the single source of truth for
// auth state so a transient /api blip doesn't misclassify.
//
// useSearchParams() forces a Suspense boundary — Next.js 15+ refuses
// to prerender pages that read search params without one. The inner
// component holds the hook; the default export is the shell.
function ReportsPageInner() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Forward the legacy in-platform CTA params (?topic=X&generate=1)
  // to /analyze. Older /chat prompts and any bookmarks still hit
  // /reports with these params — preserve the behavior by redirecting.
  useEffect(() => {
    if (isLoading) return
    const topic = searchParams.get('topic')?.trim()
    const gen = searchParams.get('generate')
    if (topic && gen === '1') {
      const qs = new URLSearchParams({ topic, generate: '1' })
      router.replace(`/analyze?${qs.toString()}`)
      return
    }
    if (!user) {
      router.replace('/analyze')
    }
  }, [isLoading, user, searchParams, router])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return <ReportsDashboard />
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      }
    >
      <ReportsPageInner />
    </Suspense>
  )
}
