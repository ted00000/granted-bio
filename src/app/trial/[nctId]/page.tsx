'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Activity, Calendar, Users, Building2, FlaskConical, ExternalLink, Bookmark } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { Breadcrumbs } from '@/components/Breadcrumbs'

interface TrialData {
  nct_id: string
  project_number: string | null
  study_title: string
  study_status: string | null
  is_therapeutic_trial: boolean
  is_diagnostic_trial: boolean
  phase: string | null
  conditions: string[] | null
  interventions: Array<{ name: string; type: string; description?: string }> | null
  enrollment_count: number | null
  lead_sponsor: string | null
  start_date: string | null
  completion_date: string | null
  eligibility_criteria: string | null
  study_type: string | null
  brief_summary: string | null
  api_last_updated: string | null
}

interface ProjectData {
  application_id: string
  title: string
  org_name: string
  total_cost: number | null
  pi_names: string | null
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Not specified'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatPhase(phase: string | null): string {
  if (!phase) return 'N/A'
  return phase.replace('PHASE', 'Phase ').replace('EARLY_PHASE1', 'Early Phase 1').replace('NA', 'N/A')
}

function formatStatus(status: string | null): { label: string; color: string } {
  if (!status) return { label: 'Unknown', color: 'bg-gray-100 text-gray-600' }

  const statusMap: Record<string, { label: string; color: string }> = {
    RECRUITING: { label: 'Recruiting', color: 'bg-green-50 text-green-700' },
    ACTIVE_NOT_RECRUITING: { label: 'Active, not recruiting', color: 'bg-blue-50 text-blue-700' },
    COMPLETED: { label: 'Completed', color: 'bg-gray-100 text-gray-600' },
    ENROLLING_BY_INVITATION: { label: 'Enrolling by invitation', color: 'bg-yellow-50 text-yellow-700' },
    NOT_YET_RECRUITING: { label: 'Not yet recruiting', color: 'bg-orange-50 text-orange-700' },
    SUSPENDED: { label: 'Suspended', color: 'bg-red-50 text-red-700' },
    TERMINATED: { label: 'Terminated', color: 'bg-red-50 text-red-700' },
    WITHDRAWN: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-500' },
  }

  return statusMap[status] || { label: status.replace(/_/g, ' '), color: 'bg-gray-100 text-gray-600' }
}

export default function TrialDetailPage() {
  const params = useParams()
  const router = useRouter()
  const nctId = params.nctId as string

  const [trial, setTrial] = useState<TrialData | null>(null)
  const [project, setProject] = useState<ProjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [savingTrial, setSavingTrial] = useState(false)

  // Check if trial is saved
  useEffect(() => {
    const checkSaved = async () => {
      try {
        const response = await fetch(`/api/saved-trials/check?nct_id=${nctId}`)
        if (response.ok) {
          const data = await response.json()
          setIsSaved(data.isSaved)
        }
      } catch (e) {
        console.error('Error checking saved status:', e)
      }
    }
    if (nctId) {
      checkSaved()
    }
  }, [nctId])

  const toggleSaveTrial = async () => {
    if (savingTrial || !trial) return
    setSavingTrial(true)
    try {
      if (isSaved) {
        const response = await fetch('/api/saved-trials', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nct_id: trial.nct_id })
        })
        if (response.ok) {
          setIsSaved(false)
        }
      } else {
        const response = await fetch('/api/saved-trials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nct_id: trial.nct_id,
            study_title: trial.study_title,
            study_status: trial.study_status,
            phase: trial.phase,
            lead_sponsor: trial.lead_sponsor
          })
        })
        if (response.ok) {
          setIsSaved(true)
        }
      }
    } catch (e) {
      console.error('Error toggling save:', e)
    } finally {
      setSavingTrial(false)
    }
  }

  useEffect(() => {
    async function fetchTrial() {
      try {
        const response = await fetch(`/api/trials/${nctId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Trial not found')
          } else {
            setError('Failed to load trial')
          }
          return
        }
        const data = await response.json()
        setTrial(data.trial)
        setProject(data.project)
      } catch (e) {
        console.error('Error fetching trial:', e)
        setError('Failed to load trial')
      } finally {
        setLoading(false)
      }
    }

    if (nctId) {
      fetchTrial()
    }
  }, [nctId])

  if (loading) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading trial...</span>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (error || !trial) {
    return (
      <AppLayout>
        <div className="h-full overflow-y-auto bg-[#FAFAF9]">
          <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
            <Breadcrumbs
              items={[
                { label: 'Search', href: '/chat' },
                { label: 'Trial' },
              ]}
            />
            <div className="text-center py-8 mt-8">
              <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Trial not found'}</h1>
              <p className="text-gray-500">The clinical trial {nctId} could not be found.</p>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  const status = formatStatus(trial.study_status)

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-5xl mx-auto pl-3 pr-5 py-6 sm:pl-4 sm:pr-6 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-6">
          {/* Breadcrumbs and save */}
          <div className="flex items-center justify-between mb-6">
            <Breadcrumbs
              items={[
                { label: 'Search', href: '/chat' },
                { label: trial.study_title.length > 40 ? trial.study_title.slice(0, 40) + '...' : trial.study_title },
              ]}
            />
            <button
              onClick={toggleSaveTrial}
              disabled={savingTrial}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-[#E07A5F] ${
                isSaved
                  ? 'bg-[#E07A5F]/10'
                  : 'hover:bg-[#E07A5F]/10'
              }`}
              title={isSaved ? 'Remove from saved' : 'Save trial'}
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
                <span className="text-[#E07A5F] font-medium text-sm">{trial.nct_id}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${status.color}`}>
                  {status.label}
                </span>
                {trial.phase && (
                  <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium">
                    {formatPhase(trial.phase)}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-semibold text-gray-900 leading-snug">
                {trial.study_title}
              </h1>
            </div>
            <a
              href={`https://clinicaltrials.gov/study/${trial.nct_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#E07A5F] transition-colors flex-shrink-0"
            >
              ClinicalTrials.gov
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {trial.brief_summary && (
            <p className="text-gray-600 text-sm leading-relaxed">
              {trial.brief_summary}
            </p>
          )}
        </div>

        {/* Key Details Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {/* Study Info */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-[#E07A5F]" />
              Study Details
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Study Type</dt>
                <dd className="text-gray-900 font-medium">
                  {trial.study_type?.replace(/_/g, ' ') || 'Not specified'}
                </dd>
              </div>
              {trial.conditions && trial.conditions.length > 0 && (
                <div>
                  <dt className="text-gray-500">Conditions</dt>
                  <dd className="text-gray-900">
                    {trial.conditions.slice(0, 5).join(', ')}
                    {trial.conditions.length > 5 && ` +${trial.conditions.length - 5} more`}
                  </dd>
                </div>
              )}
              {trial.interventions && trial.interventions.length > 0 && (
                <div>
                  <dt className="text-gray-500">Interventions</dt>
                  <dd className="text-gray-900">
                    {trial.interventions.slice(0, 3).map((i, idx) => (
                      <div key={idx} className="mb-1">
                        <span className="font-medium">{i.name}</span>
                        <span className="text-gray-500 text-xs ml-1">({i.type})</span>
                      </div>
                    ))}
                    {trial.interventions.length > 3 && (
                      <span className="text-gray-500">+{trial.interventions.length - 3} more</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Enrollment & Sponsor */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#E07A5F]" />
              Enrollment & Sponsor
            </h2>
            <dl className="space-y-3 text-sm">
              {trial.enrollment_count && (
                <div>
                  <dt className="text-gray-500">Target Enrollment</dt>
                  <dd className="text-gray-900 font-medium">
                    {trial.enrollment_count.toLocaleString()} participants
                  </dd>
                </div>
              )}
              {trial.lead_sponsor && (
                <div>
                  <dt className="text-gray-500">Lead Sponsor</dt>
                  <dd className="text-gray-900">{trial.lead_sponsor}</dd>
                </div>
              )}
              <div className="flex gap-2">
                {trial.is_therapeutic_trial && (
                  <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">
                    Therapeutic
                  </span>
                )}
                {trial.is_diagnostic_trial && (
                  <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs">
                    Diagnostic
                  </span>
                )}
              </div>
            </dl>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#E07A5F]" />
            Timeline
          </h2>
          <div className="flex gap-8 text-sm">
            <div>
              <dt className="text-gray-500">Start Date</dt>
              <dd className="text-gray-900 font-medium">{formatDate(trial.start_date)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Estimated Completion</dt>
              <dd className="text-gray-900 font-medium">{formatDate(trial.completion_date)}</dd>
            </div>
          </div>
        </div>

        {/* Eligibility */}
        {trial.eligibility_criteria && (
          <div className="bg-white rounded-lg shadow-sm p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Eligibility Criteria</h2>
            <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {trial.eligibility_criteria}
            </div>
          </div>
        )}

        {/* Linked NIH Project */}
        {project && (
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#E07A5F]" />
              Linked NIH Project
            </h2>
            <div className="text-sm">
              <Link
                href={`/project/${project.application_id}`}
                className="text-gray-900 font-medium mb-1 hover:text-[#E07A5F] transition-colors"
              >
                {project.title}
              </Link>
              <p className="text-gray-600 mt-1">{project.org_name}</p>
              {project.pi_names && (
                <p className="text-gray-500 text-xs mt-1">PI: {project.pi_names}</p>
              )}
              {project.total_cost && (
                <p className="text-[#E07A5F] font-medium mt-2">
                  ${(project.total_cost / 1000000).toFixed(1)}M funding
                </p>
              )}
            </div>
          </div>
        )}

        {/* Last Updated */}
        {trial.api_last_updated && (
          <p className="text-xs text-gray-400 text-center mt-8">
            Data last updated: {new Date(trial.api_last_updated).toLocaleDateString()}
          </p>
        )}
        </div>
      </div>
    </AppLayout>
  )
}
