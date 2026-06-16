// Retry feedback dashboard. Surfaces the rows the retry_feedback table
// has been accumulating since 2026-06-09 — previously write-only with no
// admin path to read them.
//
// Server component using the service role (gated by /admin middleware
// role check) so admins can see every row, not just their own.

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

const CATEGORY_LABELS: Record<string, string> = {
  projects_wrong: 'Wrong projects surfaced',
  too_narrow: 'Too narrow',
  too_broad: 'Too broad',
  missed_aspect: 'Missed an aspect',
  wrong_field: 'Wrong field entirely',
}

const CATEGORY_COLORS: Record<string, string> = {
  projects_wrong: 'bg-rose-100 text-rose-800',
  too_narrow: 'bg-amber-100 text-amber-800',
  too_broad: 'bg-blue-100 text-blue-800',
  missed_aspect: 'bg-purple-100 text-purple-800',
  wrong_field: 'bg-red-100 text-red-800',
}

interface FeedbackRow {
  id: string
  user_id: string
  original_report_id: string
  feedback_category: string
  feedback_text: string | null
  chosen_interpretation: {
    label?: string
    semanticQuery?: string
    keywordQuery?: string
    rationale?: string
  } | null
  resulting_report_id: string | null
  created_at: string
  generated_at: string | null
}

interface ProfileRow {
  id: string
  email: string | null
  first_name: string | null
}

interface ReportRow {
  id: string
  topic: string | null
  title: string | null
}

interface JoinedRow extends FeedbackRow {
  user_email: string | null
  user_first_name: string | null
  original_topic: string | null
  original_title: string | null
  resulting_topic: string | null
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

async function fetchFeedback(): Promise<JoinedRow[]> {
  const { data: feedbackRows, error } = await supabaseAdmin
    .from('retry_feedback')
    .select(
      'id, user_id, original_report_id, feedback_category, feedback_text, chosen_interpretation, resulting_report_id, created_at, generated_at'
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (error || !feedbackRows) {
    console.error('[admin/feedback] Failed to load retry_feedback:', error)
    return []
  }

  // Hydrate user and report data in two batched queries. Avoids running
  // N+1 selects per row.
  const userIds = Array.from(new Set(feedbackRows.map((r) => r.user_id)))
  const reportIds = Array.from(
    new Set(
      feedbackRows.flatMap((r) => [r.original_report_id, r.resulting_report_id].filter(Boolean))
    )
  ) as string[]

  const [profilesRes, reportsRes] = await Promise.all([
    supabaseAdmin
      .from('user_profiles')
      .select('id, email, first_name')
      .in('id', userIds),
    supabaseAdmin
      .from('user_reports')
      .select('id, topic, title')
      .in('id', reportIds),
  ])

  const profileById = new Map<string, ProfileRow>(
    (profilesRes.data || []).map((p) => [p.id, p as ProfileRow])
  )
  const reportById = new Map<string, ReportRow>(
    (reportsRes.data || []).map((r) => [r.id, r as ReportRow])
  )

  return feedbackRows.map((row) => {
    const profile = profileById.get(row.user_id)
    const original = reportById.get(row.original_report_id)
    const resulting = row.resulting_report_id ? reportById.get(row.resulting_report_id) : null
    return {
      ...(row as FeedbackRow),
      user_email: profile?.email ?? null,
      user_first_name: profile?.first_name ?? null,
      original_topic: original?.topic ?? null,
      original_title: original?.title ?? null,
      resulting_topic: resulting?.topic ?? null,
    }
  })
}

export default async function FeedbackPage() {
  const rows = await fetchFeedback()

  const followThroughCount = rows.filter((r) => r.resulting_report_id).length
  const followThroughPct = rows.length > 0 ? Math.round((followThroughCount / rows.length) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Retry Feedback</h1>
        <p className="mt-1 text-sm text-gray-500">
          What users said didn&apos;t work and how the refine flow proposed to fix it.
          Most recent 100 submissions.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Submissions</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{rows.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Followed through to generation</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {followThroughCount}{' '}
            <span className="text-sm text-gray-500">({followThroughPct}%)</span>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Abandoned at refine</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {rows.length - followThroughCount}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent submissions</h2>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            No retry feedback has been submitted yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rows.map((row) => (
              <div key={row.id} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          CATEGORY_COLORS[row.feedback_category] || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {CATEGORY_LABELS[row.feedback_category] || row.feedback_category}
                      </span>
                      <span className="text-xs text-gray-500">
                        {row.user_email || row.user_first_name || row.user_id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-400">
                        · {formatRelativeTime(row.created_at)}
                      </span>
                      {row.resulting_report_id ? (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800">
                          regenerated
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                          abandoned
                        </span>
                      )}
                    </div>

                    <div className="text-sm text-gray-700">
                      <span className="text-gray-500">On topic: </span>
                      <Link
                        href={`/reports/${row.original_report_id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {row.original_topic || row.original_title || row.original_report_id.slice(0, 8)}
                      </Link>
                    </div>

                    {row.feedback_text && (
                      <div className="text-sm text-gray-700 bg-gray-50 rounded p-3 italic">
                        &ldquo;{row.feedback_text}&rdquo;
                      </div>
                    )}

                    {row.chosen_interpretation?.label && (
                      <div className="text-sm">
                        <span className="text-gray-500">Chose: </span>
                        <span className="text-gray-700 font-medium">
                          {row.chosen_interpretation.label}
                        </span>
                        {row.chosen_interpretation.semanticQuery && (
                          <span className="text-gray-500 italic">
                            {' '}— &ldquo;{row.chosen_interpretation.semanticQuery}&rdquo;
                          </span>
                        )}
                      </div>
                    )}

                    {row.resulting_report_id && (
                      <div className="text-sm">
                        <span className="text-gray-500">Produced: </span>
                        <Link
                          href={`/reports/${row.resulting_report_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {row.resulting_topic || row.resulting_report_id.slice(0, 8)}
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
