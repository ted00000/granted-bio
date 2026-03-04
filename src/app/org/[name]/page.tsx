'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Building2, ChevronLeft, DollarSign, FileText, FlaskConical, Activity, Users } from 'lucide-react'

interface Project {
  application_id: string
  project_number: string
  title: string
  org_name: string | null
  org_state: string | null
  total_cost: number | null
  fiscal_year: number | null
  pi_names: string | null
  primary_category: string | null
  project_start: string | null
  project_end: string | null
  patent_count: number
  publication_count: number
  clinical_trial_count: number
}

interface OrgData {
  org_name: string
  org_state: string | null
  org_city: string | null
  org_type: string | null
  stats: {
    project_count: number
    total_funding: number
    patent_count: number
    publication_count: number
    clinical_trial_count: number
    pi_count: number
  }
  projects: Project[]
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount.toLocaleString()}`
}

function isProjectActive(endDate: string | null): boolean | null {
  if (!endDate) return null
  return new Date(endDate) > new Date()
}

export default function OrgPage() {
  const params = useParams()
  const router = useRouter()
  const name = params.name as string

  const [data, setData] = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/org/${encodeURIComponent(name)}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Organization not found')
          } else {
            setError('Failed to load organization data')
          }
          return
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Error fetching org:', err)
        setError('Failed to load organization data')
      } finally {
        setLoading(false)
      }
    }

    if (name) {
      fetchData()
    }
  }, [name])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading organization...</span>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <header className="bg-white border-b border-gray-100">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <button onClick={() => router.back()} className="text-[#E07A5F] hover:text-[#C96A4F] flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-16 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Organization not found'}</h1>
          <p className="text-gray-500">The organization "{decodeURIComponent(name)}" could not be found.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <button onClick={() => router.back()} className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium flex items-center gap-1">
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Org Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gray-100 rounded-lg">
              <Building2 className="w-8 h-8 text-gray-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-gray-900 mb-1">
                {data.org_name}
              </h1>
              <p className="text-gray-500">
                {data.org_city && `${data.org_city}, `}{data.org_state}
                {data.org_type && ` • ${data.org_type}`}
              </p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Funding</span>
            </div>
            <div className="text-xl font-semibold text-[#E07A5F]">
              {formatCurrency(data.stats.total_funding)}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <FlaskConical className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Projects</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.project_count}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">PIs</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.pi_count}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <FileText className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Patents</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.patent_count}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <FileText className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Pubs</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.publication_count}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              <Activity className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Trials</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.clinical_trial_count}
            </div>
          </div>
        </div>

        {/* Projects List */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {data.projects.map((project) => {
              const active = isProjectActive(project.project_end)
              const statusColor = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'

              return (
                <Link
                  key={project.application_id}
                  href={`/project/${project.application_id}`}
                  className="block px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <h3 className="text-sm font-medium text-gray-900 leading-snug flex-1">
                      {project.title}
                    </h3>
                    {project.total_cost && (
                      <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                        {formatCurrency(project.total_cost)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                    {project.pi_names && (
                      <span className="truncate">PI: {project.pi_names.split(';')[0]?.trim()}</span>
                    )}
                    {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                    {project.primary_category && (
                      <span className="capitalize">• {project.primary_category.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    {project.patent_count > 0 && (
                      <span>{project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}</span>
                    )}
                    {project.publication_count > 0 && (
                      <span>{project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}</span>
                    )}
                    {project.clinical_trial_count > 0 && (
                      <span>{project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
