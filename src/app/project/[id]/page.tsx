'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Project {
  id: string
  application_id: string
  project_number: string
  full_project_num: string
  title: string
  phr: string | null
  terms: string | null
  org_name: string | null
  org_type: string | null
  org_city: string | null
  org_state: string | null
  org_country: string | null
  total_cost: number | null
  award_date: string | null
  project_start: string | null
  project_end: string | null
  fiscal_year: number | null
  pi_names: string | null
  program_officer: string | null
  activity_code: string | null
  funding_mechanism: string | null
  primary_category: string | null
}

interface Publication {
  pmid: string
  pub_title: string | null
  journal_abbr: string | null
  pub_year: number | null
  is_methods_journal: boolean
  is_therapeutic_journal: boolean
}

interface Patent {
  patent_id: string
  patent_title: string | null
  is_device_patent: boolean
  is_therapeutic_patent: boolean
}

interface ClinicalStudy {
  nct_id: string
  study_title: string | null
  study_status: string | null
  is_diagnostic_trial: boolean
  is_therapeutic_trial: boolean
}

interface ProjectData {
  project: Project
  abstract: string | null
  publications: Publication[]
  patents: Patent[]
  clinicalStudies: ClinicalStudy[]
  stats: {
    publicationCount: number
    patentCount: number
    clinicalStudyCount: number
  }
}

function isProjectActive(projectEnd: string | null): boolean | null {
  if (!projectEnd) return null
  const endDate = new Date(projectEnd)
  const today = new Date()
  return endDate >= today
}

function getSbirSttrStatus(activityCode: string | null): { isSbir: boolean; isSttr: boolean } {
  if (!activityCode) return { isSbir: false, isSttr: false }
  const code = activityCode.toUpperCase()
  const isSbir = code === 'R41' || code === 'R42' || code === 'SB1'
  const isSttr = code === 'R43' || code === 'R44'
  return { isSbir, isSttr }
}

export default function ProjectPage() {
  const params = useParams()
  const id = params.id as string

  const [data, setData] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'abstract' | 'phr' | 'publications' | 'patents' | 'clinical'>('abstract')
  const [returnUrl, setReturnUrl] = useState('/chat')

  // Read return URL from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem('searchState')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.returnUrl) {
          setReturnUrl(state.returnUrl)
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/company/${id}`)
        if (!response.ok) {
          throw new Error('Failed to fetch project data')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Project Not Found</h1>
          <p className="text-gray-500 mb-4">{error}</p>
          <Link href={returnUrl} className="text-[#E07A5F] hover:underline">
            Back to Search
          </Link>
        </div>
      </div>
    )
  }

  const { project, abstract, publications, patents, clinicalStudies, stats } = data
  const active = isProjectActive(project.project_end)
  const { isSbir, isSttr } = getSbirSttrStatus(project.activity_code)

  const formatCost = (cost: number | null) => {
    if (!cost) return 'N/A'
    if (cost >= 1000000) {
      return `$${(cost / 1000000).toFixed(1)}M`
    }
    return `$${(cost / 1000).toFixed(0)}K`
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    })
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <Link href={returnUrl} className="text-sm text-gray-500 hover:text-gray-700">
              ← Back to Search
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex gap-8">
          {/* Main Content */}
          <div className="flex-1">
            {/* Project Header */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              {/* Status and Badges */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                  }`}
                  title={active === null ? 'Unknown' : active ? 'Active' : 'Inactive'}
                />
                <span className="text-xs text-gray-500">
                  {active === null ? 'Unknown Status' : active ? 'Active' : 'Inactive'}
                </span>
                {isSbir && (
                  <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                    SBIR
                  </span>
                )}
                {isSttr && (
                  <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                    STTR
                  </span>
                )}
                {project.primary_category && (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                    {project.primary_category.replace(/_/g, ' ')}
                  </span>
                )}
                {project.org_type && (
                  <span className="px-2 py-0.5 text-xs bg-gray-50 text-gray-500 rounded capitalize">
                    {project.org_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-2xl font-semibold text-gray-900 mb-4 leading-tight">
                {project.title}
              </h1>

              {/* Funding */}
              <div className="flex items-center gap-3 text-sm mb-6">
                <span className="text-2xl font-semibold text-[#E07A5F]">
                  {formatCost(project.total_cost)}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">FY{project.fiscal_year}</span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">{project.activity_code || project.funding_mechanism}</span>
              </div>

              {/* Key Info Grid */}
              <div className="grid grid-cols-2 gap-6 py-4 border-t border-gray-100">
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Organization</div>
                  <div className="font-medium text-gray-900">{project.org_name}</div>
                  <div className="text-sm text-gray-500">
                    {project.org_city}, {project.org_state}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Principal Investigator</div>
                  <div className="font-medium text-gray-900">
                    {project.pi_names?.split(';')[0]?.trim() || 'N/A'}
                  </div>
                  {project.program_officer && (
                    <div className="text-sm text-gray-500">
                      PO: {project.program_officer}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Project Period</div>
                  <div className="font-medium text-gray-900">
                    {formatDate(project.project_start)} – {formatDate(project.project_end)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Project Number</div>
                  <div className="font-medium text-gray-900">{project.project_number}</div>
                  <div className="text-xs text-gray-400">{project.full_project_num}</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-lg shadow-sm">
              <div className="border-b border-gray-100">
                <nav className="flex">
                  {[
                    { key: 'abstract', label: 'Abstract' },
                    { key: 'phr', label: 'Public Health Relevance' },
                    { key: 'publications', label: 'Publications', count: stats.publicationCount },
                    { key: 'patents', label: 'Patents', count: stats.patentCount },
                    { key: 'clinical', label: 'Clinical Trials', count: stats.clinicalStudyCount },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key as typeof activeTab)}
                      className={`px-5 py-3 text-sm font-medium transition-colors ${
                        activeTab === tab.key
                          ? 'border-b-2 border-[#E07A5F] text-[#E07A5F]'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                      {tab.count !== undefined && tab.count > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {tab.count}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
              </div>

              <div className="p-6">
                {/* Abstract Tab */}
                {activeTab === 'abstract' && (
                  <div>
                    {abstract ? (
                      <p className="text-gray-600 leading-relaxed whitespace-pre-line">{abstract}</p>
                    ) : (
                      <p className="text-gray-400 italic">No abstract available.</p>
                    )}
                  </div>
                )}

                {/* PHR Tab */}
                {activeTab === 'phr' && (
                  <div>
                    {project.phr ? (
                      <p className="text-gray-600 leading-relaxed">{project.phr}</p>
                    ) : (
                      <p className="text-gray-400 italic">No public health relevance statement available.</p>
                    )}
                  </div>
                )}

                {/* Publications Tab */}
                {activeTab === 'publications' && (
                  <div className="space-y-4">
                    {publications.length === 0 ? (
                      <p className="text-gray-400 italic">No publications linked to this project.</p>
                    ) : (
                      publications.map((pub) => (
                        <div key={pub.pmid} className="pb-4 border-b border-gray-50 last:border-0">
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-900 hover:text-[#E07A5F] font-medium"
                          >
                            {pub.pub_title || `PMID: ${pub.pmid}`}
                          </a>
                          <div className="flex gap-3 mt-1 text-sm text-gray-500">
                            <span>{pub.journal_abbr}</span>
                            <span>{pub.pub_year}</span>
                            {pub.is_methods_journal && (
                              <span className="text-green-600">Methods</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Patents Tab */}
                {activeTab === 'patents' && (
                  <div className="space-y-4">
                    {patents.length === 0 ? (
                      <p className="text-gray-400 italic">No patents linked to this project.</p>
                    ) : (
                      patents.map((patent) => (
                        <div key={patent.patent_id} className="pb-4 border-b border-gray-50 last:border-0">
                          <div className="font-medium text-gray-900">
                            {patent.patent_title || `Patent: ${patent.patent_id}`}
                          </div>
                          <div className="flex gap-3 mt-1 text-sm text-gray-500">
                            <span>Patent #{patent.patent_id}</span>
                            {patent.is_device_patent && (
                              <span className="text-blue-600">Device</span>
                            )}
                            {patent.is_therapeutic_patent && (
                              <span className="text-amber-600">Therapeutic</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Clinical Trials Tab */}
                {activeTab === 'clinical' && (
                  <div className="space-y-4">
                    {clinicalStudies.length === 0 ? (
                      <p className="text-gray-400 italic">No clinical trials linked to this project.</p>
                    ) : (
                      clinicalStudies.map((study) => (
                        <div key={study.nct_id} className="pb-4 border-b border-gray-50 last:border-0">
                          <a
                            href={`https://clinicaltrials.gov/study/${study.nct_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-900 hover:text-[#E07A5F] font-medium"
                          >
                            {study.study_title || study.nct_id}
                          </a>
                          <div className="flex gap-3 mt-1 text-sm text-gray-500">
                            <span>{study.nct_id}</span>
                            <span className="capitalize">{study.study_status?.toLowerCase()}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-72 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-5 sticky top-8">
              {/* Quick Stats */}
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                Quick Stats
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Publications</span>
                  <span className="font-medium text-gray-900">{stats.publicationCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Patents</span>
                  <span className="font-medium text-gray-900">{stats.patentCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Clinical Trials</span>
                  <span className="font-medium text-gray-900">{stats.clinicalStudyCount}</span>
                </div>
              </div>

              {/* Related Links */}
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-8 mb-4">
                Related
              </h3>
              <div className="space-y-3">
                {project.pi_names && (
                  <a
                    href={`/chat?pi=${encodeURIComponent(project.pi_names.split(';')[0]?.trim() || '')}`}
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#E07A5F] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    More from this PI
                  </a>
                )}
                <a
                  href={`/chat?org=${encodeURIComponent(project.org_name || '')}`}
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#E07A5F] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  More from {project.org_name?.split(' ').slice(0, 2).join(' ')}...
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
