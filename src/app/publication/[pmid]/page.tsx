'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { BookOpen, Calendar, Users, Building2, ExternalLink, Bookmark } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { Breadcrumbs } from '@/components/Breadcrumbs'

interface PublicationData {
  pmid: string
  pub_title: string | null
  journal_title: string | null
  journal_abbr: string | null
  pub_year: number | null
  pub_date: string | null
  author_list: string | null
  affiliation: string | null
  pmc_id: string | null
  linked_project: {
    project_number: string
    application_id: string
    title: string
    org_name: string
    total_cost: number | null
  } | null
}

interface ApiResponse {
  publication: PublicationData
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

function formatAuthors(authorList: string | null): string[] {
  if (!authorList) return []
  // Author list is typically comma-separated
  return authorList.split(',').map(a => a.trim()).filter(a => a.length > 0)
}

export default function PublicationDetailPage() {
  const params = useParams()
  const pmid = params.pmid as string

  const [publication, setPublication] = useState<PublicationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLocalOnly, setIsLocalOnly] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [savingPub, setSavingPub] = useState(false)

  // Check if publication is saved
  useEffect(() => {
    const checkSaved = async () => {
      try {
        const response = await fetch(`/api/saved-publications/check?pmid=${pmid}`)
        if (response.ok) {
          const data = await response.json()
          setIsSaved(data.isSaved)
        }
      } catch (e) {
        console.error('Error checking saved status:', e)
      }
    }
    if (pmid) {
      checkSaved()
    }
  }, [pmid])

  const toggleSavePublication = async () => {
    if (savingPub || !publication) return
    setSavingPub(true)
    try {
      if (isSaved) {
        const response = await fetch('/api/saved-publications', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pmid: publication.pmid })
        })
        if (response.ok) {
          setIsSaved(false)
        }
      } else {
        const response = await fetch('/api/saved-publications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pmid: publication.pmid,
            pub_title: publication.pub_title,
            journal_title: publication.journal_title
          })
        })
        if (response.ok) {
          setIsSaved(true)
        }
      }
    } catch (e) {
      console.error('Error toggling save:', e)
    } finally {
      setSavingPub(false)
    }
  }

  useEffect(() => {
    async function fetchPublication() {
      try {
        const response = await fetch(`/api/publications/${pmid}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Publication not found')
          } else {
            setError('Failed to load publication')
          }
          return
        }
        const data: ApiResponse = await response.json()
        setPublication(data.publication)
        setIsLocalOnly(data.source === 'linked_only')
      } catch (e) {
        console.error('Error fetching publication:', e)
        setError('Failed to load publication')
      } finally {
        setLoading(false)
      }
    }

    if (pmid) {
      fetchPublication()
    }
  }, [pmid])

  if (loading) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading publication...</span>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (error || !publication) {
    return (
      <AppLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
            <Breadcrumbs
              items={[
                { label: 'Publications', href: '/' },
                { label: 'Publication' },
              ]}
            />
            <div className="text-center py-8">
              <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Publication not found'}</h1>
              <p className="text-gray-500">The publication PMID:{pmid} could not be found.</p>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  const authors = formatAuthors(publication.author_list)

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
          {/* Breadcrumbs and save */}
          <div className="flex items-center justify-between mb-6">
            <Breadcrumbs
              items={[
                { label: 'Publications', href: '/' },
                { label: publication.pub_title && publication.pub_title.length > 40 ? publication.pub_title.slice(0, 40) + '...' : publication.pub_title || `PMID: ${pmid}` },
              ]}
            />
            <button
              onClick={toggleSavePublication}
              disabled={savingPub}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-[#E07A5F] ${
                isSaved
                  ? 'bg-[#E07A5F]/10'
                  : 'hover:bg-[#E07A5F]/10'
              }`}
              title={isSaved ? 'Remove from saved' : 'Save publication'}
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
                  <span className="text-[#E07A5F] font-medium text-sm">PMID:{publication.pmid}</span>
                  {publication.journal_abbr && (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                      {publication.journal_abbr}
                    </span>
                  )}
                  {publication.pub_year && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">
                      {publication.pub_year}
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-semibold text-gray-900 leading-snug">
                  {publication.pub_title || `Publication PMID:${publication.pmid}`}
                </h1>
              </div>
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex-shrink-0"
              >
                PubMed
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {isLocalOnly && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-amber-800 text-sm">
                  Limited data available. Visit{' '}
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-medium hover:text-amber-900"
                  >
                    PubMed
                  </a>
                  {' '}for full publication details including abstract and citations.
                </p>
              </div>
            )}

            {publication.journal_title && (
              <p className="text-gray-600 text-sm">
                <span className="font-medium">Journal:</span> {publication.journal_title}
              </p>
            )}
          </div>

          {/* Details Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {/* Authors */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E07A5F]" />
                Authors
              </h2>
              <dl className="space-y-3 text-sm">
                {authors.length > 0 ? (
                  <div>
                    <dd className="text-gray-900">
                      {authors.slice(0, 10).join(', ')}
                      {authors.length > 10 && ` +${authors.length - 10} more`}
                    </dd>
                  </div>
                ) : (
                  <p className="text-gray-500 italic">No author data available</p>
                )}
                {publication.affiliation && (
                  <div className="pt-2 border-t border-gray-100">
                    <dt className="text-gray-500 text-xs mb-1">Affiliation</dt>
                    <dd className="text-gray-600 text-xs">{publication.affiliation}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Publication Details */}
            <div className="bg-white rounded-lg shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#E07A5F]" />
                Details
              </h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">Publication Date</dt>
                  <dd className="text-gray-900 font-medium">
                    {publication.pub_date ? formatDate(publication.pub_date) : (publication.pub_year ? String(publication.pub_year) : 'Not specified')}
                  </dd>
                </div>
                {publication.pmc_id && (
                  <div>
                    <dt className="text-gray-500">PMC ID</dt>
                    <dd className="text-gray-900">
                      <a
                        href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${publication.pmc_id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#E07A5F] hover:underline"
                      >
                        {publication.pmc_id}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {/* Linked NIH Project */}
          {publication.linked_project && (
            <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#E07A5F]" />
                Linked NIH Project
              </h2>
              <div className="text-sm">
                <Link
                  href={`/project/${publication.linked_project.application_id}`}
                  className="text-gray-900 font-medium mb-1 hover:text-[#E07A5F] transition-colors"
                >
                  {publication.linked_project.title}
                </Link>
                <p className="text-gray-600 mt-1">{publication.linked_project.org_name}</p>
                {publication.linked_project.total_cost && (
                  <p className="text-[#E07A5F] font-medium mt-2">
                    ${(publication.linked_project.total_cost / 1000000).toFixed(1)}M funding
                  </p>
                )}
              </div>
            </div>
          )}

          {/* External Link */}
          <div className="text-center">
            <a
              href={`https://pubmed.ncbi.nlm.nih.gov/${publication.pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-500 hover:text-[#E07A5F] transition-colors inline-flex items-center gap-1"
            >
              View full publication on PubMed
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
