'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, ChevronLeft, ChevronRight, DollarSign, FileText, FlaskConical, Activity, Building2, Search, X } from 'lucide-react'

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
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

interface Filters {
  categories: string[]
  years: number[]
}

interface ResearcherData {
  pi_name: string
  primary_org: string
  org_state: string | null
  stats: {
    project_count: number
    total_funding: number
    patent_count: number
    publication_count: number
    clinical_trial_count: number
    org_count: number
  }
  projects: Project[]
  pagination: Pagination
  filters: Filters
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

export default function ResearcherPage() {
  const params = useParams()
  const router = useRouter()
  const name = params.name as string

  const [data, setData] = useState<ResearcherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams()
      if (searchQuery) queryParams.set('search', searchQuery)
      if (selectedCategory) queryParams.set('category', selectedCategory)
      if (selectedYear) queryParams.set('year', selectedYear)
      if (selectedStatus) queryParams.set('status', selectedStatus)
      queryParams.set('page', currentPage.toString())
      queryParams.set('limit', '20')

      const url = `/api/researcher/${encodeURIComponent(name)}?${queryParams.toString()}`
      const response = await fetch(url)
      if (!response.ok) {
        if (response.status === 404) {
          setError('Researcher not found')
        } else {
          setError('Failed to load researcher data')
        }
        return
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      console.error('Error fetching researcher:', err)
      setError('Failed to load researcher data')
    } finally {
      setLoading(false)
    }
  }, [name, searchQuery, selectedCategory, selectedYear, selectedStatus, currentPage])

  useEffect(() => {
    if (name) {
      fetchData()
    }
  }, [name, fetchData])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedCategory, selectedYear, selectedStatus])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchQuery(searchInput)
  }

  const clearFilters = () => {
    setSearchInput('')
    setSearchQuery('')
    setSelectedCategory('')
    setSelectedYear('')
    setSelectedStatus('')
    setCurrentPage(1)
  }

  const hasActiveFilters = searchQuery || selectedCategory || selectedYear || selectedStatus

  // Show full-page loading only on initial load
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading researcher...</span>
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
          <User className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Researcher not found'}</h1>
          <p className="text-gray-500">No projects found for "{decodeURIComponent(name)}".</p>
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
        {/* Researcher Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gray-100 rounded-full">
              <User className="w-8 h-8 text-gray-600" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold text-gray-900 mb-1">
                {data.pi_name}
              </h1>
              {data.primary_org && (
                <Link
                  href={`/org/${encodeURIComponent(data.primary_org)}`}
                  className="text-gray-500 hover:text-[#E07A5F] transition-colors"
                >
                  {data.primary_org}
                  {data.org_state && `, ${data.org_state}`}
                </Link>
              )}
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
              <Building2 className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wider">Orgs</span>
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {data.stats.org_count}
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
              {data.pagination && (
                <span className="text-sm text-gray-500">
                  {data.pagination.total.toLocaleString()} project{data.pagination.total !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search projects by title or organization..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => { setSearchInput(''); setSearchQuery('') }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>

            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              {data.filters?.categories && data.filters.categories.length > 0 && (
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]"
                >
                  <option value="">All Categories</option>
                  {data.filters.categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </option>
                  ))}
                </select>
              )}

              {data.filters?.years && data.filters.years.length > 0 && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]"
                >
                  <option value="">All Years</option>
                  {data.filters.years.map((year) => (
                    <option key={year} value={year}>FY{year}</option>
                  ))}
                </select>
              )}

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/20 focus:border-[#E07A5F]"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>

              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="px-3 py-1.5 text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Loading overlay for filter changes */}
          <div className={`relative ${loading ? 'opacity-50' : ''}`}>
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
                      {project.org_name && (
                        <span className="truncate">{project.org_name}</span>
                      )}
                      {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                      {project.primary_category && (
                        <span className="capitalize">• {project.primary_category.replace(/_/g, ' ')}</span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Empty state */}
            {data.projects.length === 0 && (
              <div className="px-6 py-12 text-center">
                <FlaskConical className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No projects match your filters</p>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="mt-2 text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {/* Pagination */}
            {data.pagination && data.pagination.totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                <div className="text-sm text-gray-500">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={!data.pagination.hasPrev || loading}
                    className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => p + 1)}
                    disabled={!data.pagination.hasNext || loading}
                    className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
