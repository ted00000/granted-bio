'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Building2, ChevronLeft, ChevronRight, FlaskConical, Search, X, Bookmark } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { Breadcrumbs } from '@/components/Breadcrumbs'

// Display names for categories
const CATEGORY_LABELS: Record<string, string> = {
  biotools: 'Biotools',
  therapeutics: 'Therapeutics',
  diagnostics: 'Diagnostics',
  medical_device: 'Medical Devices',
  digital_health: 'Digital Health',
  basic_research: 'Basic Research',
  training: 'Training',
  other: 'Other'
}

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
  activity_code: string | null
  patent_count: number
  publication_count: number
  clinical_trial_count: number
}

// Helper to detect SBIR/STTR from activity code
function getSbirSttrStatus(activityCode: string | null): { isSbir: boolean; isSttr: boolean; phase: number | null } {
  if (!activityCode) return { isSbir: false, isSttr: false, phase: null }
  const code = activityCode.toUpperCase()
  const isSbir = code.startsWith('R43') || code.startsWith('R44')
  const isSttr = code.startsWith('R41') || code.startsWith('R42')
  let phase: number | null = null
  if (code.startsWith('R43') || code.startsWith('R41')) phase = 1
  if (code.startsWith('R44') || code.startsWith('R42')) phase = 2
  return { isSbir, isSttr, phase }
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
  byCategory: Record<string, number>
  byYear: Record<number, number>
  byStatus: { active: number; completed: number }
  byQuickFilter?: { hasPatents: number; hasPubs: number; hasTrials: number }
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

export default function OrgPage() {
  const params = useParams()
  const router = useRouter()
  const name = params.name as string

  const [data, setData] = useState<OrgData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [hasPatentsFilter, setHasPatentsFilter] = useState(false)
  const [hasPubsFilter, setHasPubsFilter] = useState(false)
  const [hasTrialsFilter, setHasTrialsFilter] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)

  // Bookmark state
  const [isSaved, setIsSaved] = useState(false)
  const [savingOrg, setSavingOrg] = useState(false)

  // Check if org is saved
  useEffect(() => {
    const checkSaved = async () => {
      try {
        const orgName = decodeURIComponent(name)
        const response = await fetch(`/api/saved-people/check?person_name=${encodeURIComponent(orgName)}&person_type=organization`)
        const data = await response.json()
        setIsSaved(data.saved)
      } catch {
        // Ignore errors
      }
    }
    checkSaved()
  }, [name])

  const toggleSaveOrg = async () => {
    if (savingOrg) return
    setSavingOrg(true)

    const orgName = decodeURIComponent(name)

    try {
      if (isSaved) {
        await fetch(`/api/saved-people?person_name=${encodeURIComponent(orgName)}&person_type=organization`, { method: 'DELETE' })
        setIsSaved(false)
      } else {
        await fetch('/api/saved-people', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_name: orgName, person_type: 'organization' })
        })
        setIsSaved(true)
      }
    } catch {
      // Ignore errors
    } finally {
      setSavingOrg(false)
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams()
      if (searchQuery) queryParams.set('search', searchQuery)
      if (selectedCategory) queryParams.set('category', selectedCategory)
      if (selectedYear) queryParams.set('year', selectedYear)
      if (selectedStatus) queryParams.set('status', selectedStatus)
      if (hasPatentsFilter) queryParams.set('hasPatents', 'true')
      if (hasPubsFilter) queryParams.set('hasPubs', 'true')
      if (hasTrialsFilter) queryParams.set('hasTrials', 'true')
      queryParams.set('page', currentPage.toString())
      queryParams.set('limit', '50')

      const url = `/api/org/${encodeURIComponent(name)}?${queryParams.toString()}`
      const response = await fetch(url)
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
  }, [name, searchQuery, selectedCategory, selectedYear, selectedStatus, hasPatentsFilter, hasPubsFilter, hasTrialsFilter, currentPage])

  useEffect(() => {
    if (name) {
      fetchData()
    }
  }, [name, fetchData])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedCategory, selectedYear, selectedStatus, hasPatentsFilter, hasPubsFilter, hasTrialsFilter])

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
    setHasPatentsFilter(false)
    setHasPubsFilter(false)
    setHasTrialsFilter(false)
    setCurrentPage(1)
  }

  const hasActiveFilters = searchQuery || selectedCategory || selectedYear || selectedStatus || hasPatentsFilter || hasPubsFilter || hasTrialsFilter

  // Show full-page loading only on initial load
  if (loading && !data) {
    return (
      <AppLayout>
        <div className="h-full flex items-center justify-center bg-[#FAFAF9]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading organization...</span>
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
            <div className="flex items-center gap-3 mb-8">
              <button
                onClick={() => router.back()}
                className="p-1.5 -ml-1.5 rounded-lg text-[#E07A5F] hover:bg-[#E07A5F]/10 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <Breadcrumbs
                items={[
                  { label: 'Organizations' },
                  { label: decodeURIComponent(name) },
                ]}
              />
            </div>
            <div className="text-center py-8">
              <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h1 className="text-xl font-semibold text-gray-900 mb-2">{error || 'Organization not found'}</h1>
              <p className="text-gray-500">The organization "{decodeURIComponent(name)}" could not be found.</p>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="h-full flex flex-col bg-[#FAFAF9]">
        {/* Top header with back button, org info, and bookmark */}
        <div className="flex-shrink-0 border-b border-gray-100 bg-white">
          <div className="px-5 py-4">
            {/* Back button, breadcrumbs, and bookmark */}
            <div className="flex items-center justify-between mb-4">
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
                    { label: 'Organizations' },
                    { label: data.org_name.length > 40 ? data.org_name.slice(0, 40) + '...' : data.org_name },
                  ]}
                />
              </div>
              <button
                onClick={toggleSaveOrg}
                disabled={savingOrg}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-[#E07A5F] ${
                  isSaved
                    ? 'bg-[#E07A5F]/10'
                    : 'hover:bg-[#E07A5F]/10'
                }`}
                title={isSaved ? 'Remove from saved' : 'Save organization'}
              >
                <Bookmark
                  className="w-4 h-4"
                  fill={isSaved ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                />
                <span className="text-sm">Save</span>
              </button>
            </div>
            {/* Org info */}
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {data.org_name}
              </h1>
              <p className="text-sm text-gray-500">
                {data.org_city && `${data.org_city}, `}{data.org_state}
                {data.org_type && ` • ${data.org_type}`}
              </p>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left column - Stats and filters */}
          <div className="w-80 lg:w-96 flex-shrink-0 border-r border-gray-100 overflow-y-auto bg-[#FAFAF9]">
            <div className="p-5 space-y-4">
              {/* Stats card */}
              <div className="bg-white rounded-lg border border-gray-100 p-4">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="text-3xl font-semibold tracking-tight text-gray-900">
                    {hasActiveFilters ? data.pagination.total : data.stats.project_count}
                  </span>
                  <span className="text-sm text-gray-400">
                    projects{hasActiveFilters && ' (filtered)'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Total Funding</div>
                    <div className="text-sm font-semibold text-[#E07A5F]">{formatCurrency(data.stats.total_funding)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Researchers</div>
                    <div className="text-sm font-semibold text-gray-900">{data.stats.pi_count}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Patents</div>
                    <div className="text-sm font-semibold text-gray-900">{data.stats.patent_count}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Publications</div>
                    <div className="text-sm font-semibold text-gray-900">{data.stats.publication_count}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Clinical Trials</div>
                    <div className="text-sm font-semibold text-gray-900">{data.stats.clinical_trial_count}</div>
                  </div>
                </div>
              </div>

              {/* Filter Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFiltersCollapsed(!filtersCollapsed)}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {filtersCollapsed ? 'Show' : 'Hide'}
                  </button>
                  <span className="text-gray-300">·</span>
                  <span className="text-sm font-medium text-gray-500">Filters</span>
                  {filtersCollapsed && hasActiveFilters && (
                    <span className="text-xs text-gray-500">
                      ({(selectedStatus ? 1 : 0) + (selectedCategory ? 1 : 0) + (selectedYear ? 1 : 0) + (hasPatentsFilter ? 1 : 0) + (hasPubsFilter ? 1 : 0) + (hasTrialsFilter ? 1 : 0)} active)
                    </span>
                  )}
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Filter Chips */}
              {!filtersCollapsed && (
                <div className="space-y-3">
                  {/* Status and quick filters */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {/* Status filters */}
                      {data.filters?.byStatus && [
                        { key: 'active', label: 'Active', count: data.filters.byStatus.active },
                        { key: 'completed', label: 'Completed', count: data.filters.byStatus.completed },
                      ].map(({ key, label, count }) => {
                        const isSelected = selectedStatus === key
                        const isDisabled = loading || (!isSelected && count === 0)
                        return (
                          <button
                            key={key}
                            onClick={() => setSelectedStatus(isSelected ? '' : key)}
                            disabled={isDisabled}
                            className={`
                              px-2 py-1 text-xs rounded-md border transition-all
                              ${isSelected
                                ? 'bg-emerald-500 text-white border-emerald-500'
                                : count === 0
                                  ? 'bg-white/50 text-gray-300 border-gray-100 cursor-not-allowed'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
                              }
                              ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                          >
                            {label}
                            <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                              {count.toLocaleString()}
                            </span>
                          </button>
                        )
                      })}
                      {/* Quick filters */}
                      {data.filters?.byQuickFilter && [
                        { key: 'hasPatents', label: 'Has Patents', count: data.filters.byQuickFilter.hasPatents, state: hasPatentsFilter, setState: setHasPatentsFilter },
                        { key: 'hasPubs', label: 'Has Pubs', count: data.filters.byQuickFilter.hasPubs, state: hasPubsFilter, setState: setHasPubsFilter },
                        { key: 'hasTrials', label: 'Has Trials', count: data.filters.byQuickFilter.hasTrials, state: hasTrialsFilter, setState: setHasTrialsFilter },
                      ].map(({ key, label, count, state, setState }) => {
                        const isDisabled = loading || (!state && count === 0)
                        return (
                          <button
                            key={key}
                            onClick={() => setState(!state)}
                            disabled={isDisabled}
                            className={`
                              px-2 py-1 text-xs rounded-md border transition-all
                              ${state
                                ? 'bg-emerald-500 text-white border-emerald-500'
                                : count === 0
                                  ? 'bg-white/50 text-gray-300 border-gray-100 cursor-not-allowed'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
                              }
                              ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                            `}
                          >
                            {label}
                            <span className={`ml-1 ${state ? 'text-white/80' : 'text-gray-400'}`}>
                              {count.toLocaleString()}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Category filters */}
                  {data.filters?.byCategory && Object.keys(data.filters.byCategory).length > 0 && (
                    <div>
                      <h4 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Life Science Area</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(data.filters.byCategory)
                          .sort(([, a], [, b]) => b - a)
                          .map(([cat, count]) => {
                            const isSelected = selectedCategory === cat
                            const isDisabled = loading || (!isSelected && count === 0)
                            const label = CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                            return (
                              <button
                                key={cat}
                                onClick={() => setSelectedCategory(isSelected ? '' : cat)}
                                disabled={isDisabled}
                                className={`
                                  px-2 py-1 text-xs rounded-md border transition-all
                                  ${isSelected
                                    ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                                    : count === 0
                                      ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                                      : 'bg-white text-gray-600 border-gray-300 hover:border-[#E07A5F]'
                                  }
                                  ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                              >
                                {label}
                                <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                                  {count.toLocaleString()}
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* Year filters */}
                  {data.filters?.byYear && Object.keys(data.filters.byYear).length > 0 && (
                    <div>
                      <h4 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Fiscal Year</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(data.filters.byYear)
                          .sort(([a], [b]) => Number(b) - Number(a))
                          .map(([yr, count]) => {
                            const isSelected = selectedYear === yr
                            const isDisabled = loading || (!isSelected && count === 0)
                            return (
                              <button
                                key={yr}
                                onClick={() => setSelectedYear(isSelected ? '' : yr)}
                                disabled={isDisabled}
                                className={`
                                  px-2 py-1 text-xs rounded-md border transition-all
                                  ${isSelected
                                    ? 'bg-gray-800 text-white border-gray-800'
                                    : count === 0
                                      ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                                  }
                                  ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                                `}
                              >
                                FY{yr}
                                <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                                  {count.toLocaleString()}
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right column - Projects list */}
          <div className="flex-1 overflow-y-auto bg-white">
            {/* Search bar - sticky at top */}
            <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-gray-100">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search projects by title or PI..."
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
            </div>

            {/* Project list */}
            <div className={`relative ${loading ? 'opacity-50' : ''}`}>
              <div className="divide-y divide-gray-50">
                {data.projects.map((project) => {
                  const active = isProjectActive(project.project_end)
                  const statusColor = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'

                  return (
                    <Link
                      key={project.application_id}
                      href={`/project/${project.application_id}`}
                      className="group block px-6 py-4 hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="text-sm font-medium text-gray-900 leading-snug flex-1 group-hover:text-[#E07A5F] transition-colors">
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
                      </div>
                      {/* Tags row */}
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        {(() => {
                          const { isSbir, isSttr, phase } = getSbirSttrStatus(project.activity_code)
                          return (
                            <>
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
                            </>
                          )
                        })()}
                        {project.primary_category && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize">
                            {project.primary_category.replace(/_/g, ' ')}
                          </span>
                        )}
                        {project.patent_count > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded">
                            {project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}
                          </span>
                        )}
                        {project.publication_count > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                            {project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}
                          </span>
                        )}
                        {project.clinical_trial_count > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                            {project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}
                          </span>
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
        </div>
      </div>
    </AppLayout>
  )
}
