'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bookmark, FileText, Heart, BookOpen, Lightbulb, Activity, Pencil, ArrowLeft } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { CategoryEditModal } from '@/components/CategoryEditModal'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import { useAuth } from '@/contexts/AuthContext'

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
  secondary_category: string | null
  primary_category_confidence: number | null
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

function getSbirSttrStatus(activityCode: string | null): { isSbir: boolean; isSttr: boolean; phase: 1 | 2 | null } {
  if (!activityCode) return { isSbir: false, isSttr: false, phase: null }
  const code = activityCode.toUpperCase()
  const isSbir = code === 'R41' || code === 'R42' || code === 'SB1'
  const isSttr = code === 'R43' || code === 'R44'
  const phase = (code === 'R41' || code === 'R43') ? 1 : (code === 'R42' || code === 'R44') ? 2 : null
  return { isSbir, isSttr, phase }
}

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [data, setData] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'abstract' | 'phr' | 'publications' | 'patents' | 'clinical'>('abstract')
  const [returnUrl, setReturnUrl] = useState('/chat')
  const [isSaved, setIsSaved] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const { isAdmin } = useAuth()

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

  // Check if project is saved
  useEffect(() => {
    const checkSaved = async () => {
      try {
        const response = await fetch(`/api/saved-projects/check?application_id=${id}`)
        const data = await response.json()
        setIsSaved(data.saved)
      } catch (e) {
        // Ignore errors
      }
    }
    checkSaved()
  }, [id])

  const toggleSave = async () => {
    if (savingProject) return
    setSavingProject(true)

    try {
      if (isSaved) {
        await fetch(`/api/saved-projects?application_id=${id}`, { method: 'DELETE' })
        setIsSaved(false)
      } else {
        await fetch('/api/saved-projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ application_id: id })
        })
        setIsSaved(true)
      }
    } catch (e) {
      console.error('Error toggling save:', e)
    } finally {
      setSavingProject(false)
    }
  }

  const handleSaveCategory = async (category: string, confidence: number) => {
    const response = await fetch(`/api/admin/project/${data?.project.application_id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, confidence })
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to save category')
    }

    // Update local state
    if (data) {
      setData({
        ...data,
        project: {
          ...data.project,
          primary_category: category,
          primary_category_confidence: confidence
        }
      })
    }
  }

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
      <AppLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading project...</span>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="p-1.5 -ml-1.5 rounded-lg text-[#E07A5F] hover:bg-[#E07A5F]/10 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Breadcrumbs
                items={[
                  { label: 'Projects' },
                  { label: 'Project' },
                ]}
              />
            </div>
            <div className="text-center py-8 mt-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Project Not Found</h1>
              <p className="text-gray-500">{error}</p>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  const { project, abstract, publications, patents, clinicalStudies, stats } = data
  const active = isProjectActive(project.project_end)
  const { isSbir, isSttr, phase } = getSbirSttrStatus(project.activity_code)

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
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
          {/* Back button, breadcrumbs, and bookmark */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="p-1.5 -ml-1.5 rounded-lg text-[#E07A5F] hover:bg-[#E07A5F]/10 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Breadcrumbs
                items={[
                  { label: 'Projects' },
                  { label: project.title.length > 40 ? project.title.slice(0, 40) + '...' : project.title },
                ]}
              />
            </div>
            <button
              onClick={toggleSave}
              disabled={savingProject}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-[#E07A5F] ${
                isSaved
                  ? 'bg-[#E07A5F]/10'
                  : 'hover:bg-[#E07A5F]/10'
              }`}
              title={isSaved ? 'Remove from saved' : 'Save project'}
            >
              <Bookmark
                className="w-4 h-4"
                fill={isSaved ? 'currentColor' : 'none'}
                strokeWidth={1.5}
              />
              <span className="text-sm">Save</span>
            </button>
          </div>
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Project Header */}
            <div className="bg-white rounded-lg shadow-sm p-4 lg:p-6 mb-4 lg:mb-6">
              {/* Status and Badges */}
              <div className="flex flex-wrap items-center gap-1.5 lg:gap-2 mb-3">
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                  }`}
                  title={active === null ? 'Unknown' : active ? 'Active' : 'Inactive'}
                />
                <span className="text-xs text-gray-500">
                  {active === null ? 'Unknown' : active ? 'Active' : 'Inactive'}
                </span>
                {isSbir && (
                  <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                    SBIR{phase ? ` ${phase === 1 ? 'I' : 'II'}` : ''}
                  </span>
                )}
                {isSttr && (
                  <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                    STTR{phase ? ` ${phase === 1 ? 'I' : 'II'}` : ''}
                  </span>
                )}
                {project.primary_category && (
                  <span className="inline-flex items-center gap-1">
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                      {project.primary_category.replace(/_/g, ' ')}
                    </span>
                    {project.primary_category_confidence && (
                      <span className={`w-2 h-2 rounded-full ${
                        project.primary_category_confidence >= 80 ? 'bg-green-400' :
                        project.primary_category_confidence >= 50 ? 'bg-yellow-400' : 'bg-red-400'
                      }`} title={`${project.primary_category_confidence}% confidence`} />
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setShowCategoryModal(true)}
                        className="p-0.5 text-gray-400 hover:text-[#E07A5F] transition-colors"
                        title="Edit category"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                )}
                {project.org_type && (
                  <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded capitalize">
                    {project.org_type.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-xl lg:text-2xl font-semibold text-gray-900 mb-4 leading-tight">
                {project.title}
              </h1>

              {/* Funding */}
              <div className="flex flex-wrap items-center gap-2 lg:gap-3 text-sm mb-4 lg:mb-6">
                <span className="text-xl lg:text-2xl font-semibold text-[#E07A5F]">
                  {formatCost(project.total_cost)}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">FY{project.fiscal_year}</span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-600">{project.activity_code || project.funding_mechanism}</span>
              </div>

              {/* Key Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 py-4 border-t border-gray-100">
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
              <div className="p-3 lg:p-4 overflow-x-auto">
                <nav className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-full">
                  {[
                    { key: 'abstract', label: 'Abstract', icon: FileText },
                    { key: 'phr', label: 'PHR', icon: Heart },
                    { key: 'publications', label: 'Pubs', icon: BookOpen, count: stats.publicationCount },
                    { key: 'patents', label: 'Patents', icon: Lightbulb, count: stats.patentCount },
                    { key: 'clinical', label: 'Trials', icon: Activity, count: stats.clinicalStudyCount },
                  ].map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key as typeof activeTab)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-all whitespace-nowrap ${
                          isActive
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#E07A5F]' : ''}`} strokeWidth={isActive ? 2 : 1.5} />
                        <span className={isActive ? 'font-medium' : ''}>{tab.label}</span>
                        {tab.count !== undefined && tab.count > 0 && (
                          <span className={`px-1.5 py-0.5 text-xs rounded ${isActive ? 'bg-gray-100 text-gray-600' : 'bg-gray-200/50 text-gray-500'}`}>
                            {tab.count}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </nav>
              </div>

              <div className="p-4 lg:p-6">
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
                          <Link
                            href={`/publication/${pub.pmid}`}
                            className="text-gray-900 hover:text-[#E07A5F] font-medium"
                          >
                            {pub.pub_title || `PMID: ${pub.pmid}`}
                          </Link>
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
                          <Link
                            href={`/patent/${patent.patent_id}`}
                            className="font-medium text-gray-900 hover:text-[#E07A5F]"
                          >
                            {patent.patent_title || `Patent: ${patent.patent_id}`}
                          </Link>
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
                          <Link
                            href={`/trial/${study.nct_id}`}
                            className="text-gray-900 hover:text-[#E07A5F] font-medium"
                          >
                            {study.study_title || study.nct_id}
                          </Link>
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

          {/* Sidebar - hidden on mobile, shown on desktop */}
          <div className="hidden lg:block w-72 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm p-5 sticky top-20">
              {/* Related Links */}
              <h3 className="text-sm font-medium text-gray-500 mb-4">
                Related
              </h3>
              <div className="space-y-3">
                {project.pi_names && (
                  <Link
                    href={`/researcher/${encodeURIComponent(project.pi_names.split(';')[0]?.trim() || '')}`}
                    className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#E07A5F] transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    More from this PI
                  </Link>
                )}
                <Link
                  href={`/org/${encodeURIComponent(project.org_name || '')}`}
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-[#E07A5F] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  More from {project.org_name?.split(' ').slice(0, 2).join(' ')}...
                </Link>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* Category Edit Modal (Admin only) */}
      <CategoryEditModal
        isOpen={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onSave={handleSaveCategory}
        currentCategory={project.primary_category}
        currentConfidence={project.primary_category_confidence}
        projectTitle={project.title}
      />
    </AppLayout>
  )
}
