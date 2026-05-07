'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { FileText, Calendar, Users, Building2, Tag, ExternalLink, Quote, Bookmark } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { Breadcrumbs } from '@/components/Breadcrumbs'

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

  // Breadcrumb back-target — uses document.referrer when same-origin so the
  // breadcrumb returns to the actual source page (e.g. /org/[name], search).
  const [returnUrl, setReturnUrl] = useState('/chat')
  useEffect(() => {
    if (typeof document === 'undefined' || !document.referrer) return
    try {
      const url = new URL(document.referrer)
      if (url.origin === window.location.origin) {
        setReturnUrl(url.pathname + url.search)
      }
    } catch {
      // invalid referrer URL, keep default
    }
  }, [])

  // Check if patent is saved
  useEffect(() => {
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
  }, [patentId])

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
      } catch (e) {
        console.error('Error fetching patent:', e)
        setError('Failed to load patent')
      } finally {
        setLoading(false)
      }
    }

    if (patentId) {
      fetchPatent()
    }
  }, [patentId])

  if (loading) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading patent...</span>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (error || !patent) {
    return (
      <AppLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
            <Breadcrumbs
              items={[
                { label: 'Patents', href: returnUrl },
                { label: 'Patent' },
              ]}
            />
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Patent not found'}</h1>
              <p className="text-gray-500">The patent US{patentId} could not be found.</p>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
          {/* Breadcrumbs and save */}
          <div className="flex items-center justify-between mb-6">
            <Breadcrumbs
              items={[
                { label: 'Patents', href: returnUrl },
                { label: patent.patent_title && patent.patent_title.length > 40 ? patent.patent_title.slice(0, 40) + '...' : patent.patent_title || `Patent ${patentId}` },
              ]}
            />
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

          {/* Details Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* Assignee */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E07A5F]" />
                Assignee
              </h2>
              <dl className="space-y-3 text-sm">
                {patent.assignees.length > 0 ? (
                  <div>
                    <dd className="text-gray-900">
                      {patent.assignees.map((assignee, idx) => (
                        <div key={idx} className="font-medium">{assignee}</div>
                      ))}
                    </dd>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">View full patent on USPTO for assignee details</p>
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
            </div>

            {/* Details */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#E07A5F]" />
                Details
              </h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Issue Date</dt>
                  <dd className="text-gray-900 font-medium">{formatDate(patent.patent_date)}</dd>
                </div>
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
              </dl>
            </div>
          </div>

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
                <p className="text-gray-600 mt-1">{patent.linked_project.org_name}</p>
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
    </AppLayout>
  )
}
