'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Signal {
  tier: number
  source: string
  signal: string
  weight: number
  reasoning?: string
}

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
  funding_mechanism: string | null
  primary_category: string | null
  biotools_confidence: number | null
  biotools_reasoning: string | null
  biotools_signals: Signal[] | null
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

interface CompanyData {
  project: Project
  abstract: string | null
  publications: Publication[]
  patents: Patent[]
  clinicalStudies: ClinicalStudy[]
  stats: {
    publicationCount: number
    patentCount: number
    clinicalStudyCount: number
    methodsJournalCount: number
    devicePatentCount: number
  }
}

export default function CompanyPage() {
  const params = useParams()
  const slug = params.slug as string

  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'publications' | 'patents' | 'clinical'>('overview')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/company/${slug}`)
        if (!response.ok) {
          throw new Error('Failed to fetch company data')
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
  }, [slug])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Project Not Found</h1>
          <p className="text-gray-500 mb-4">{error}</p>
          <Link href="/search" className="text-blue-600 hover:underline">
            Back to Search
          </Link>
        </div>
      </div>
    )
  }

  const { project, abstract, publications, patents, clinicalStudies, stats } = data

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return 'bg-gray-100 text-gray-600'
    if (confidence >= 60) return 'bg-green-100 text-green-800'
    if (confidence >= 35) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  const formatCost = (cost: number | null) => {
    if (!cost) return 'N/A'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(cost)
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-blue-600">
              granted.bio
            </Link>
            <Link href="/search" className="text-sm text-gray-500 hover:text-gray-700">
              Back to Search
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Project Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                {project.title}
              </h1>
              <p className="text-lg text-blue-600 font-medium">
                {project.org_name}
              </p>
            </div>
            <div className="text-right">
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getConfidenceColor(
                  project.biotools_confidence
                )}`}
              >
                Biotools Confidence: {project.biotools_confidence?.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Key Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-t border-gray-200">
            <div>
              <div className="text-xs text-gray-500 uppercase">Project Number</div>
              <div className="font-medium text-gray-900">{project.project_number}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Total Funding</div>
              <div className="font-medium text-gray-900">{formatCost(project.total_cost)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Fiscal Year</div>
              <div className="font-medium text-gray-900">FY{project.fiscal_year}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Organization Type</div>
              <div className="font-medium text-gray-900 capitalize">{project.org_type}</div>
            </div>
          </div>

          {/* Location & Funding */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-t border-gray-200">
            <div>
              <div className="text-xs text-gray-500 uppercase">Location</div>
              <div className="font-medium text-gray-900">
                {project.org_city}, {project.org_state}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Funding Mechanism</div>
              <div className="font-medium text-gray-900">{project.funding_mechanism || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Project Start</div>
              <div className="font-medium text-gray-900">{formatDate(project.project_start)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase">Project End</div>
              <div className="font-medium text-gray-900">{formatDate(project.project_end)}</div>
            </div>
          </div>

          {/* PI Names */}
          {project.pi_names && (
            <div className="py-4 border-t border-gray-200">
              <div className="text-xs text-gray-500 uppercase mb-1">Principal Investigators</div>
              <div className="text-gray-900">{project.pi_names}</div>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.publicationCount}</div>
            <div className="text-xs text-gray-500">Publications</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.methodsJournalCount}</div>
            <div className="text-xs text-gray-500">Methods Papers</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.patentCount}</div>
            <div className="text-xs text-gray-500">Patents</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.devicePatentCount}</div>
            <div className="text-xs text-gray-500">Device Patents</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.clinicalStudyCount}</div>
            <div className="text-xs text-gray-500">Clinical Trials</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px">
              {(['overview', 'publications', 'patents', 'clinical'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-6 py-4 text-sm font-medium ${
                    activeTab === tab
                      ? 'border-b-2 border-blue-500 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'overview' && 'Overview'}
                  {tab === 'publications' && `Publications (${stats.publicationCount})`}
                  {tab === 'patents' && `Patents (${stats.patentCount})`}
                  {tab === 'clinical' && `Clinical (${stats.clinicalStudyCount})`}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Public Health Relevance */}
                {project.phr && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Public Health Relevance
                    </h3>
                    <p className="text-gray-600">{project.phr}</p>
                  </div>
                )}

                {/* Abstract */}
                {abstract && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Abstract
                    </h3>
                    <p className="text-gray-600 whitespace-pre-line">{abstract}</p>
                  </div>
                )}

                {/* Classification Signals */}
                {project.biotools_signals && project.biotools_signals.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Classification Signals
                    </h3>
                    {project.biotools_reasoning && (
                      <p className="text-gray-600 mb-4 italic">
                        {project.biotools_reasoning}
                      </p>
                    )}
                    <div className="space-y-2">
                      {project.biotools_signals.map((signal, i) => (
                        <div
                          key={i}
                          className={`flex items-center justify-between p-3 rounded-lg ${
                            signal.weight > 0 ? 'bg-green-50' : 'bg-red-50'
                          }`}
                        >
                          <div>
                            <span className="text-xs text-gray-500 uppercase">
                              Tier {signal.tier} - {signal.source}
                            </span>
                            <div className="font-medium text-gray-900">{signal.signal}</div>
                          </div>
                          <span
                            className={`font-bold ${
                              signal.weight > 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {signal.weight > 0 ? '+' : ''}
                            {signal.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Keywords */}
                {project.terms && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Keywords
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {project.terms.split(';').slice(0, 20).map((term, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded"
                        >
                          {term.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Publications Tab */}
            {activeTab === 'publications' && (
              <div className="space-y-4">
                {publications.length === 0 ? (
                  <p className="text-gray-500">No publications found for this project.</p>
                ) : (
                  publications.map((pub) => (
                    <div key={pub.pmid} className="border-b border-gray-100 pb-4">
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {pub.pub_title || `PMID: ${pub.pmid}`}
                      </a>
                      <div className="flex gap-4 mt-1 text-sm text-gray-500">
                        <span>{pub.journal_abbr}</span>
                        <span>{pub.pub_year}</span>
                        {pub.is_methods_journal && (
                          <span className="text-green-600 font-medium">Methods Journal</span>
                        )}
                        {pub.is_therapeutic_journal && (
                          <span className="text-orange-600 font-medium">Therapeutic Journal</span>
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
                  <p className="text-gray-500">No patents found for this project.</p>
                ) : (
                  patents.map((patent) => (
                    <div key={patent.patent_id} className="border-b border-gray-100 pb-4">
                      <div className="font-medium text-gray-900">
                        {patent.patent_title || `Patent ID: ${patent.patent_id}`}
                      </div>
                      <div className="flex gap-4 mt-1 text-sm text-gray-500">
                        <span>Patent #{patent.patent_id}</span>
                        {patent.is_device_patent && (
                          <span className="text-blue-600 font-medium">Device Patent</span>
                        )}
                        {patent.is_therapeutic_patent && (
                          <span className="text-orange-600 font-medium">Therapeutic Patent</span>
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
                  <p className="text-gray-500">No clinical trials found for this project.</p>
                ) : (
                  clinicalStudies.map((study) => (
                    <div key={study.nct_id} className="border-b border-gray-100 pb-4">
                      <a
                        href={`https://clinicaltrials.gov/study/${study.nct_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {study.study_title || study.nct_id}
                      </a>
                      <div className="flex gap-4 mt-1 text-sm text-gray-500">
                        <span>{study.nct_id}</span>
                        <span className="capitalize">{study.study_status?.toLowerCase()}</span>
                        {study.is_diagnostic_trial && (
                          <span className="text-blue-600 font-medium">Diagnostic</span>
                        )}
                        {study.is_therapeutic_trial && (
                          <span className="text-orange-600 font-medium">Therapeutic</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
