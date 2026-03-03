'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { FileText, Calendar, Users, Building2, Tag, ExternalLink, ChevronLeft, Quote } from 'lucide-react'

interface PatentData {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  patent_date: string | null
  patent_type: string | null
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
  source: 'local' | 'uspto'
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

export default function PatentDetailPage() {
  const params = useParams()
  const patentId = params.patentId as string

  const [patent, setPatent] = useState<PatentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLocalOnly, setIsLocalOnly] = useState(false)

  useEffect(() => {
    async function fetchPatent() {
      try {
        const response = await fetch(`/api/patents/${patentId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Patent not found')
          } else if (response.status === 429) {
            setError('USPTO API rate limited. Please try again later.')
          } else {
            setError('Failed to load patent')
          }
          return
        }
        const data: ApiResponse = await response.json()
        setPatent(data.patent)
        setIsLocalOnly(data.source === 'local')
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
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading patent...</span>
        </div>
      </div>
    )
  }

  if (error || !patent) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <header className="bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <Link href="/chat?persona=investor" className="text-[#E07A5F] hover:text-[#C96A4F] flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" />
              Back to Search
            </Link>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-16 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Patent not found'}</h1>
          <p className="text-gray-500">The patent US{patentId} could not be found.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <Link href="/chat?persona=investor" className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" />
              Back to Search
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
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
                {patent.patent_title || 'Untitled Patent'}
              </h1>
            </div>
            <a
              href={`https://patents.google.com/patent/US${patent.patent_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex-shrink-0"
            >
              Google Patents
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {isLocalOnly && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <p className="text-amber-800 text-sm">
                Limited data available. Visit{' '}
                <a
                  href={`https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO1&Sect2=HITOFF&d=PALL&p=1&u=%2Fnetahtml%2FPTO%2Fsrchnum.htm&r=1&f=G&l=50&s1=${patent.patent_id}.PN.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium hover:text-amber-900"
                >
                  USPTO
                </a>
                {' '}for full patent details including abstract, claims, and citations.
              </p>
            </div>
          )}

          {patent.patent_abstract && (
            <div className="text-gray-600 text-sm leading-relaxed">
              <h3 className="font-medium text-gray-900 mb-2">Abstract</h3>
              <p>{patent.patent_abstract}</p>
            </div>
          )}
        </div>

        {/* Details Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {/* Inventors & Assignees */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#E07A5F]" />
              Inventors & Assignees
            </h2>
            <dl className="space-y-3 text-sm">
              {patent.inventors.length > 0 && (
                <div>
                  <dt className="text-gray-500">Inventors</dt>
                  <dd className="text-gray-900">
                    {patent.inventors.slice(0, 5).join(', ')}
                    {patent.inventors.length > 5 && ` +${patent.inventors.length - 5} more`}
                  </dd>
                </div>
              )}
              {patent.assignees.length > 0 && (
                <div>
                  <dt className="text-gray-500">Assignees</dt>
                  <dd className="text-gray-900">
                    {patent.assignees.map((assignee, idx) => (
                      <div key={idx} className="font-medium">{assignee}</div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Classification & Date */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#E07A5F]" />
              Details
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Grant Date</dt>
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
          <div className="bg-white rounded-lg shadow-sm p-5">
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

        {/* External Links */}
        <div className="flex gap-4 mt-8 justify-center">
          <a
            href={`https://patents.google.com/patent/US${patent.patent_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex items-center gap-1"
          >
            View on Google Patents
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={`https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO1&Sect2=HITOFF&d=PALL&p=1&u=%2Fnetahtml%2FPTO%2Fsrchnum.htm&r=1&f=G&l=50&s1=${patent.patent_id}.PN.`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex items-center gap-1"
          >
            View on USPTO
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </main>
    </div>
  )
}
