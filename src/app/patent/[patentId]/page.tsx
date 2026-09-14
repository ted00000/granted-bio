'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { FileText, Calendar, Users, Building2, Tag, ExternalLink, Quote, Bookmark, Loader2, AlertCircle } from 'lucide-react'
import { DetailLayout } from '@/components/DetailLayout'
import { BackButton } from '@/components/BackButton'
import { useAuth } from '@/contexts/AuthContext'
import { normalizeOrgName } from '@/lib/format-names'

interface AssignmentHistoryEntry {
  conveyance: string | null
  recorded_date: string | null
  assignees: string[]
}

interface PatentData {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  patent_date: string | null
  patent_type: string | null
  patent_org: string | null
  assignees: string[]
  inventors: string[]
  cpc_codes: string[]
  cited_by_count: number
  // ODP-hydrated fields (null / empty until hydration writes them)
  application_number: string | null
  patent_type_code: string | null
  patent_status: string | null
  examiner_name: string | null
  art_unit: string | null
  uspc_code: string | null
  current_assignees: string[]
  assignment_history: AssignmentHistoryEntry[]
  api_last_updated: string | null
  hydration_error: string | null
  linked_project: {
    project_number: string
    application_id: string
    title: string
    org_name: string
    total_cost: number | null
  } | null
}

interface ApiResponse {
  patent: PatentData
  source: 'local' | 'linked_only'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not specified'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatPatentType(type: string | null): string {
  if (!type) return 'Utility'
  const typeMap: Record<string, string> = {
    'utility': 'Utility Patent',
    'design': 'Design Patent',
    'plant': 'Plant Patent',
    'reissue': 'Reissue Patent'
  }
  return typeMap[type.toLowerCase()] || type
}

// USPTO PDF download URL
function getUSPTOUrl(patentId: string): string {
  return `https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/${patentId}`
}

export default function PatentDetailPage() {
  const params = useParams()
  const patentId = params.patentId as string

  const [patent, setPatent] = useState<PatentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [savingPatent, setSavingPatent] = useState(false)
  // Hydration state: fires exactly once per page load if the row is
  // un-hydrated. Ref-guarded so React StrictMode's double-invoke of
  // effects in development doesn't double-post to /hydrate.
  const [hydrating, setHydrating] = useState(false)
  const [hydrationMessage, setHydrationMessage] = useState<string | null>(null)
  const hydrateFiredRef = useRef(false)
  const { user } = useAuth()


  // Check if patent is saved. Skip for logged-out visitors — the API
  // requires auth and the bookmark button is hidden in that case.
  useEffect(() => {
    if (!user) return
    const checkSaved = async () => {
      try {
        const response = await fetch(`/api/saved-patents/check?patent_id=${patentId}`)
        if (response.ok) {
          const data = await response.json()
          setIsSaved(data.isSaved)
        }
      } catch (e) {
        console.error('Error checking saved status:', e)
      }
    }
    if (patentId) {
      checkSaved()
    }
  }, [patentId, user])

  const toggleSavePatent = async () => {
    if (savingPatent || !patent) return
    setSavingPatent(true)
    try {
      if (isSaved) {
        const response = await fetch('/api/saved-patents', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patent_id: patent.patent_id })
        })
        if (response.ok) {
          setIsSaved(false)
        }
      } else {
        const response = await fetch('/api/saved-patents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patent_id: patent.patent_id,
            patent_title: patent.patent_title
          })
        })
        if (response.ok) {
          setIsSaved(true)
        }
      }
    } catch (e) {
      console.error('Error toggling save:', e)
    } finally {
      setSavingPatent(false)
    }
  }

  useEffect(() => {
    async function fetchPatent() {
      try {
        const response = await fetch(`/api/patents/${patentId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Patent not found')
          } else {
            setError('Failed to load patent')
          }
          return
        }
        const data: ApiResponse = await response.json()
        setPatent(data.patent)
        // Lazy hydration: if this row has never been enriched from
        // USPTO ODP AND we haven't previously errored on hydration,
        // fire the hydrate endpoint and refetch. Fires at most once
        // per page load (ref-guarded against StrictMode).
        if (
          !data.patent.api_last_updated &&
          !data.patent.hydration_error &&
          !hydrateFiredRef.current
        ) {
          hydrateFiredRef.current = true
          void triggerHydration()
        }
      } catch (e) {
        console.error('Error fetching patent:', e)
        setError('Failed to load patent')
      } finally {
        setLoading(false)
      }
    }

    async function triggerHydration() {
      setHydrating(true)
      setHydrationMessage(null)
      try {
        const res = await fetch(`/api/patents/${patentId}/hydrate`, {
          method: 'POST',
        })
        if (res.status === 429) {
          const body = await res.json().catch(() => ({}))
          const retryAfter = body?.retry_after_seconds ?? 60
          setHydrationMessage(
            `USPTO rate limit hit. Try again in about ${retryAfter}s.`,
          )
          return
        }
        if (res.status === 404) {
          setHydrationMessage('USPTO does not have this patent on record.')
          // Refetch anyway so the persisted hydration_error is picked up.
          await refetchPatent()
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setHydrationMessage(
            body?.error ? `Enrichment failed: ${body.error}` : 'Enrichment failed.',
          )
          await refetchPatent()
          return
        }
        // Success — refetch to pull the newly written columns.
        await refetchPatent()
      } catch (e) {
        console.error('Hydration failed:', e)
        setHydrationMessage('Enrichment request failed. Please retry later.')
      } finally {
        setHydrating(false)
      }
    }

    async function refetchPatent() {
      try {
        const r = await fetch(`/api/patents/${patentId}`)
        if (r.ok) {
          const d: ApiResponse = await r.json()
          setPatent(d.patent)
        }
      } catch (e) {
        console.error('Refetch after hydration failed:', e)
      }
    }

    if (patentId) {
      fetchPatent()
    }
  }, [patentId])

  if (loading) {
    return (
      <DetailLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading patent...</span>
          </div>
        </div>
      </DetailLayout>
    )
  }

  if (error || !patent) {
    return (
      <DetailLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
            <BackButton />
            <div className="text-center py-8 mt-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Patent not found'}</h1>
              <p className="text-gray-500">The patent US{patentId} could not be found.</p>
            </div>
          </div>
        </div>
      </DetailLayout>
    )
  }

  return (
    <DetailLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
          {/* Back button and save */}
          <div className="flex items-center justify-between mb-6">
            <BackButton />
            {user && (
              <button
                onClick={toggleSavePatent}
                disabled={savingPatent}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-[#E07A5F] ${
                  isSaved
                    ? 'bg-[#E07A5F]/10'
                    : 'hover:bg-[#E07A5F]/10'
                }`}
                title={isSaved ? 'Remove from saved' : 'Save patent'}
              >
                <Bookmark
                  className="w-4 h-4"
                  fill={isSaved ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                />
                <span className="text-sm">Save</span>
              </button>
            )}
          </div>

          {/* Title Section */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[#E07A5F] font-medium text-sm">US{patent.patent_id}</span>
                  <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                    {formatPatentType(patent.patent_type)}
                  </span>
                  {patent.cited_by_count > 0 && (
                    <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium flex items-center gap-1">
                      <Quote className="w-3 h-3" />
                      {patent.cited_by_count} citations
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-semibold text-gray-900 leading-snug">
                  {patent.patent_title || `Patent US${patent.patent_id}`}
                </h1>
                {patent.patent_org && (
                  <p className="text-gray-600 mt-2">{patent.patent_org}</p>
                )}
              </div>
              <a
                href={getUSPTOUrl(patent.patent_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex-shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on USPTO
              </a>
            </div>

            {patent.patent_abstract && (
              <div className="text-gray-600 text-sm leading-relaxed">
                <h3 className="font-medium text-gray-900 mb-2">Abstract</h3>
                <p>{patent.patent_abstract}</p>
              </div>
            )}
          </div>

          {/* Hydration status message (rate-limit / error banners).
              Rendered only when there is something to say — success is
              silent because the panels below already reflect the new
              data.  */}
          {hydrationMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
              <span>{hydrationMessage}</span>
            </div>
          )}

          {/* Details Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* Assignee */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E07A5F]" />
                Assignee
                {hydrating && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Fetching from USPTO
                  </span>
                )}
              </h2>
              {hydrating && patent.assignees.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
                  Getting inventors and assignees from USPTO (~3 seconds)…
                </p>
              ) : (
                <dl className="space-y-3 text-sm">
                  {patent.assignees.length > 0 ? (
                    <div>
                      <dt className="text-gray-500 mb-1">
                        Original applicant{patent.assignees.length > 1 ? 's' : ''}
                      </dt>
                      <dd className="text-gray-900">
                        {patent.assignees.map((assignee, idx) => (
                          <div key={idx} className="font-medium">{normalizeOrgName(assignee)}</div>
                        ))}
                      </dd>
                    </div>
                  ) : (
                    <p className="text-gray-500 italic">
                      View full patent on USPTO for assignee details
                    </p>
                  )}
                  {patent.current_assignees.length > 0 &&
                    JSON.stringify(patent.current_assignees.map(normalizeOrgName).sort()) !==
                      JSON.stringify(patent.assignees.map(normalizeOrgName).sort()) && (
                      <div className="pt-2 border-t border-gray-100">
                        <dt className="text-gray-500 mb-1">Current owner</dt>
                        <dd className="text-gray-900">
                          {patent.current_assignees.map((a, idx) => (
                            <div key={idx} className="font-medium">
                              {normalizeOrgName(a)}
                            </div>
                          ))}
                        </dd>
                      </div>
                    )}
                  {patent.inventors.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                      <dt className="text-gray-500 mb-1">Inventors</dt>
                      <dd className="text-gray-900">
                        {patent.inventors.slice(0, 5).join(', ')}
                        {patent.inventors.length > 5 && ` +${patent.inventors.length - 5} more`}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {/* Details */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#E07A5F]" />
                Details
                {hydrating && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Fetching from USPTO
                  </span>
                )}
              </h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Issue Date</dt>
                  <dd className="text-gray-900 font-medium">{formatDate(patent.patent_date)}</dd>
                </div>
                {patent.application_number && (
                  <div>
                    <dt className="text-gray-500">Application number</dt>
                    <dd className="text-gray-900 font-medium">{patent.application_number}</dd>
                  </div>
                )}
                {patent.patent_status && (
                  <div>
                    <dt className="text-gray-500">Status</dt>
                    <dd className="text-gray-900 font-medium">{patent.patent_status}</dd>
                  </div>
                )}
                {patent.examiner_name && (
                  <div>
                    <dt className="text-gray-500">USPTO examiner</dt>
                    <dd className="text-gray-900">{patent.examiner_name}</dd>
                  </div>
                )}
                {patent.art_unit && (
                  <div>
                    <dt className="text-gray-500">Art unit</dt>
                    <dd className="text-gray-900">{patent.art_unit}</dd>
                  </div>
                )}
                {patent.uspc_code && (
                  <div>
                    <dt className="text-gray-500">USPC</dt>
                    <dd className="text-gray-900">{patent.uspc_code}</dd>
                  </div>
                )}
                {patent.cpc_codes.length > 0 && (
                  <div>
                    <dt className="text-gray-500 flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      CPC Classifications
                    </dt>
                    <dd className="text-gray-600 text-xs mt-1">
                      {patent.cpc_codes.slice(0, 5).join(', ')}
                      {patent.cpc_codes.length > 5 && ` +${patent.cpc_codes.length - 5} more`}
                    </dd>
                  </div>
                )}
                {hydrating && patent.cpc_codes.length === 0 && (
                  <p className="text-xs text-gray-400 italic">
                    Getting CPC codes and examiner data from USPTO…
                  </p>
                )}
              </dl>
            </div>
          </div>

          {/* Assignment history — only renders when hydrated AND there
              is more than one entry (single-entry history is redundant
              with the "original applicant" line). */}
          {patent.assignment_history.length > 1 && (
            <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#E07A5F]" />
                Assignment history
              </h2>
              <ol className="space-y-3 text-sm">
                {patent.assignment_history.map((entry, idx) => (
                  <li key={idx} className="border-l-2 border-gray-100 pl-3">
                    <div className="text-gray-500 text-xs">
                      {entry.recorded_date ? formatDate(entry.recorded_date) : 'Undated'}
                      {entry.conveyance && ` · ${entry.conveyance}`}
                    </div>
                    <div className="text-gray-900">
                      {entry.assignees.map((a) => normalizeOrgName(a)).join(', ') || '—'}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Linked NIH Project */}
          {patent.linked_project && (
            <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#E07A5F]" />
                Linked NIH Project
              </h2>
              <div className="text-sm">
                <Link
                  href={`/project/${patent.linked_project.application_id}`}
                  className="text-gray-900 font-medium mb-1 hover:text-[#E07A5F] transition-colors"
                >
                  {patent.linked_project.title}
                </Link>
                <p className="text-gray-600 mt-1">{normalizeOrgName(patent.linked_project.org_name)}</p>
                {patent.linked_project.total_cost && (
                  <p className="text-[#E07A5F] font-medium mt-2">
                    ${(patent.linked_project.total_cost / 1000000).toFixed(1)}M funding
                  </p>
                )}
              </div>
            </div>
          )}

          {/* External Link */}
          <div className="text-center">
            <a
              href={getUSPTOUrl(patent.patent_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-[#E07A5F] transition-colors inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View full patent on USPTO
            </a>
          </div>
        </div>
      </div>
    </DetailLayout>
  )
}
