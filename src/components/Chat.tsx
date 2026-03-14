'use client'

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search, TrendingUp, Users, Activity, Bookmark, Download } from 'lucide-react'
import type { PersonaType, KeywordSearchResult, SearchResultProject, TrialSearchResult } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'
import { FilterChips } from './FilterChips'

const ICONS = {
  search: Search,
  trending: TrendingUp,
  users: Users,
  activity: Activity,
} as const

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isToolCall?: boolean
}

interface ToolResult {
  name: string
  data: unknown
  timestamp: number
}

// Search context for filtering without Claude
interface SearchContext {
  keywordQuery: string
  semanticQuery: string
  originalResults: KeywordSearchResult
}

// Filter state types
interface QuickFilters {
  activeOnly?: boolean
  sbirSttrOnly?: boolean
  hasPatents?: boolean
  hasClinicalTrials?: boolean
  precision?: 'low' | 'med' | 'high'
}

// Precision filtering uses percentiles (not fixed thresholds) for consistent differentiation
// Low: All results, Med: Top 50%, High: Top 20%
const PRECISION_PERCENTILES = {
  low: 1.0,    // 100% - all results
  med: 0.5,    // 50% - top half
  high: 0.2    // 20% - top fifth
} as const

interface FilterState {
  primary_category?: string[]
  org_type?: string[]
  quick?: QuickFilters
}

interface ChatProps {
  persona: PersonaType
  initialQuery?: string
}

// Parse message content to extract choices (bullet points at the end)
function parseMessageWithChoices(content: string): { text: string; choices: string[] } {
  const lines = content.split('\n')
  const choices: string[] = []
  let lastNonChoiceIndex = lines.length - 1

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    // Only match • for choices - dashes and asterisks are used for other lists
    if (line.startsWith('•')) {
      const choice = line.replace(/^•\s*/, '').trim()
      if (choice) {
        choices.unshift(choice)
        lastNonChoiceIndex = i - 1
      }
    } else if (line === '') {
      continue
    } else {
      break
    }
  }

  const text = lines.slice(0, lastNonChoiceIndex + 1).join('\n').trim()
  return { text, choices }
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount}`
}

// Determine SBIR/STTR status from activity code
function getSbirSttrStatus(activityCode: string | null | undefined): { isSbir: boolean; isSttr: boolean; phase: 1 | 2 | null } {
  if (!activityCode) return { isSbir: false, isSttr: false, phase: null }
  const code = activityCode.toUpperCase()
  // R41, R42 = SBIR Phase I/II
  // R43, R44 = STTR Phase I/II
  // SB1 = SBIR/STTR (we'll call it SBIR for display)
  const isSbir = code === 'R41' || code === 'R42' || code === 'SB1'
  const isSttr = code === 'R43' || code === 'R44'
  const phase = (code === 'R41' || code === 'R43') ? 1 : (code === 'R42' || code === 'R44') ? 2 : null
  return { isSbir, isSttr, phase }
}

// Determine if project is active based on end date
function isProjectActive(projectEnd: string | null | undefined): boolean | null {
  if (!projectEnd) return null // Unknown status
  const endDate = new Date(projectEnd)
  const today = new Date()
  return endDate >= today
}

// Results Panel Component
interface ResultsPanelProps {
  results: ToolResult[]
  searchContext: SearchContext | null
  filteredResults: KeywordSearchResult | null
  onFilterChange: (filters: FilterState) => void
  // Cross-filtered counts for dynamic chip numbers
  crossFilteredByCategory?: Record<string, number>
  crossFilteredByOrgType?: Record<string, number>
  // Quick filter counts
  quickFilterCounts?: {
    active: number
    sbirSttr: number
    patents: number
    clinicalTrials: number
    precisionLow: number
    precisionMed: number
    precisionHigh: number
  }
  // Navigate to project detail (saves state first)
  onProjectClick?: (applicationId: string) => void
  // Navigate to org detail (saves state first)
  onOrgClick?: (orgName: string) => void
  // Navigate to researcher detail (saves state first)
  onResearcherClick?: (researcherName: string) => void
  // Mobile-specific styling
  isMobile?: boolean
  // Trial status filters
  trialStatusFilters?: string[]
  onTrialStatusChange?: (statuses: string[]) => void
  // Trial saving
  savedTrialIds?: Set<string>
  onSaveTrial?: (nctId: string) => void
  // Navigate to trial detail (saves state first)
  onTrialClick?: (nctId: string) => void
  // Persona for mode-specific rendering
  persona?: PersonaType
  // Precision filter
  precision?: 'low' | 'med' | 'high'
  onPrecisionChange?: (precision: 'low' | 'med' | 'high') => void
  precisionCounts?: { low: number; med: number; high: number }
  // Sticky collapsible filters (for right panel on desktop)
  stickyFilters?: boolean
  // Current filter state for showing active count
  currentFilters?: FilterState
  // Hide stats and filters (for two-column layout where filters are in sidebar)
  hideStatsAndFilters?: boolean
}

function ResultsPanel({ results, searchContext, filteredResults, onFilterChange, crossFilteredByCategory, crossFilteredByOrgType, quickFilterCounts, onProjectClick, onOrgClick, onResearcherClick, isMobile = false, trialStatusFilters = [], onTrialStatusChange, savedTrialIds = new Set(), onSaveTrial, onTrialClick, persona, precision = 'low', onPrecisionChange, precisionCounts, stickyFilters = false, currentFilters = {}, hideStatsAndFilters = false }: ResultsPanelProps) {
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)

  // Count active filters for collapsed state display
  const activeFilterCount = (currentFilters.primary_category?.length || 0) +
    (currentFilters.org_type?.length || 0) +
    (currentFilters.quick ? Object.values(currentFilters.quick).filter(Boolean).length : 0)
  // CSV export for People mode
  const exportToCSV = (projects: SearchResultProject[]) => {
    const headers = ['Organization', 'State', 'PI Name', 'Project Title', 'Funding', 'Category', 'Patents', 'Publications', 'Trials']
    const rows = projects.map(p => [
      p.org_name || '',
      p.org_state || '',
      p.pi_names?.split(';')[0]?.trim() || '',
      p.title || '',
      p.total_cost ? `$${(p.total_cost / 1000000).toFixed(2)}M` : '',
      p.primary_category?.replace(/_/g, ' ') || '',
      String(p.patent_count || 0),
      String(p.publication_count || 0),
      String(p.clinical_trial_count || 0)
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-[#E07A5F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-400">Results will show here</p>
        </div>
      </div>
    )
  }

  // Check for trials results first (trials mode should show trials, not projects)
  const trialsResult = [...results].reverse().find(r => r.name === 'search_trials')
  if (trialsResult) {
    // Use trials result directly - don't fall through to project handlers
  }

  // Prioritize project results over patent results when both exist
  // This ensures "find projects with patents" shows projects (with patent badges), not raw patents
  // Use findLast to get the MOST RECENT search result (in case of multiple searches in one response)
  const projectResult = [...results].reverse().find(r => r.name === 'search_projects' || r.name === 'keyword_search')
  const latestResult = trialsResult || projectResult || results[results.length - 1]

  // Use filtered results if available, otherwise use original
  const displayData = filteredResults || (projectResult?.data as KeywordSearchResult | undefined)

  if (latestResult.name === 'keyword_search') {
    // Use displayData if available (for filtered results), otherwise fall back to raw data
    const data = displayData || latestResult.data as KeywordSearchResult

    const isCapped = data.showing_count && data.showing_count < data.total_count
    const isFiltered = filteredResults !== null

    return (
      <div className={`overflow-y-auto ${isMobile ? '' : 'h-full'}`}>
        {/* Stats section - hidden in two-column mode */}
        {!hideStatsAndFilters && (
        <div className={`${isMobile ? 'p-4' : 'p-6'} border-b border-gray-100`}>
          <div className={`${isMobile ? 'text-3xl' : 'text-4xl'} font-semibold tracking-tight text-gray-900`}>{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">
            projects found{isCapped && ` · showing top ${data.showing_count}`}
            {isFiltered && ' (filtered)'}
          </div>
          {searchContext && (
            <div className="text-xs text-gray-400 mt-2 truncate" title={`Keyword: ${searchContext.keywordQuery}\nSemantic: ${searchContext.semanticQuery}`}>
              Searched: {searchContext.semanticQuery || searchContext.keywordQuery}
            </div>
          )}
          {/* Precision filter - hidden on desktop when shown in middle column */}
          {!stickyFilters && onPrecisionChange && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1.5">Match quality</div>
              <div className="flex gap-1.5">
                {[
                  { level: 'low' as const, label: 'Broad', count: precisionCounts?.low },
                  { level: 'med' as const, label: 'Balanced', count: precisionCounts?.med },
                  { level: 'high' as const, label: 'Precise', count: precisionCounts?.high },
                ].map(({ level, label, count }) => {
                  const isSelected = precision === level
                  return (
                    <button
                      key={level}
                      onClick={() => onPrecisionChange(level)}
                      className={`
                        px-2.5 py-1 text-xs rounded-full border transition-all
                        ${isSelected
                          ? 'bg-indigo-500 text-white border-indigo-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                        }
                      `}
                    >
                      {label}
                      {count !== undefined && (
                        <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Filter Chips - sticky and collapsible on desktop - hidden in two-column mode */}
        {!hideStatsAndFilters && searchContext && data.all_results?.length > 0 && (
          <div className={`${stickyFilters ? 'sticky top-0 z-10 bg-white shadow-sm' : ''} ${isMobile ? 'p-4' : 'p-4'} border-b border-gray-100`}>
            {stickyFilters && (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFiltersCollapsed(!filtersCollapsed)}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {filtersCollapsed ? 'Show' : 'Hide'}
                  </button>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider">Filter Results</span>
                  {filtersCollapsed && activeFilterCount > 0 && (
                    <span className="text-xs text-gray-500">
                      ({activeFilterCount} active)
                    </span>
                  )}
                </div>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => onFilterChange({})}
                    className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            <div className={stickyFilters && filtersCollapsed ? 'hidden' : ''}>
              <FilterChips
                byCategory={searchContext.originalResults.by_category || {}}
                byOrgType={searchContext.originalResults.by_org_type || {}}
                filteredByCategory={crossFilteredByCategory}
                filteredByOrgType={crossFilteredByOrgType}
                quickFilterCounts={quickFilterCounts}
                keywordQuery={searchContext.keywordQuery}
                semanticQuery={searchContext.semanticQuery}
                onFilterChange={onFilterChange}
                isLoading={false}
                hideHeader={stickyFilters}
              />
            </div>
          </div>
        )}

        {data.all_results?.length > 0 && (
          <div className={isMobile ? 'p-4' : 'p-6'}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider">
                {persona === 'bd' ? 'Contacts' : 'Most Relevant'}
              </h3>
              <button
                onClick={() => exportToCSV(data.all_results)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 hover:text-[#E07A5F] hover:bg-gray-50 rounded transition-colors"
                title="Export to CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>
            <div className={isMobile ? 'space-y-3' : 'space-y-5'}>
              {data.all_results.slice(0, isMobile ? 50 : 100).map((project) => (
                persona === 'bd' ? (
                  // People-focused layout: org and PI names are clickable links
                  <div
                    key={project.application_id}
                    className={isMobile
                      ? 'bg-white rounded-xl p-4 shadow-sm border border-gray-100'
                      : 'pb-4 border-b border-gray-50 last:border-0 last:pb-0 -mx-2 px-2 rounded-lg'}
                  >
                    <div className={`flex items-start justify-between ${isMobile ? 'gap-2' : 'gap-3'} mb-1`}>
                      {project.org_name ? (
                        <button
                          onClick={() => onOrgClick?.(project.org_name!)}
                          className="text-sm font-medium text-gray-900 leading-snug flex-1 break-words hover:text-[#E07A5F] transition-colors text-left"
                        >
                          {project.org_name}
                        </button>
                      ) : (
                        <span className="text-sm font-medium text-gray-900 leading-snug flex-1 break-words">
                          Unknown Organization
                        </span>
                      )}
                      {project.total_cost && (
                        <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                          {formatCurrency(project.total_cost)}
                        </span>
                      )}
                    </div>
                    {project.pi_names && (
                      <button
                        onClick={() => onResearcherClick?.(project.pi_names!.split(';')[0]?.trim() || '')}
                        className="text-sm text-gray-700 mt-1 block hover:text-[#E07A5F] transition-colors text-left"
                      >
                        {project.pi_names.split(';')[0]?.trim()}
                      </button>
                    )}
                    <button
                      onClick={() => onProjectClick?.(project.application_id)}
                      className="text-xs text-gray-500 mt-2 line-clamp-2 text-left hover:text-[#E07A5F] transition-colors"
                    >
                      {project.title}
                    </button>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                      {(() => {
                        const active = isProjectActive(project.project_end)
                        const color = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                        const label = active === null ? 'Unknown' : active ? 'Active' : 'Inactive'
                        return (
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`}
                            title={label}
                          />
                        )
                      })()}
                      {project.org_state && <span>{project.org_state}</span>}
                      {project.primary_category && (
                        <span className="capitalize">{project.primary_category.replace(/_/g, ' ')}</span>
                      )}
                      {project.patent_count > 0 && (
                        <span>{project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}</span>
                      )}
                      {project.publication_count > 0 && (
                        <span>{project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    key={project.application_id}
                    onClick={() => onProjectClick?.(project.application_id)}
                    className={`group block w-full text-left ${isMobile
                      ? 'bg-white rounded-xl p-4 shadow-sm border border-gray-100 active:bg-gray-50'
                      : 'pb-4 border-b border-gray-50 last:border-0 last:pb-0 hover:bg-gray-50/50 -mx-2 px-2 rounded-lg transition-colors'}`}
                  >
                    <div className={`flex items-start justify-between ${isMobile ? 'gap-2' : 'gap-3'} mb-2`}>
                      <span className="text-sm text-gray-900 leading-snug flex-1 break-words group-hover:text-[#E07A5F] transition-colors">
                        {project.title}
                      </span>
                      {project.total_cost && (
                        <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                          {formatCurrency(project.total_cost)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {(() => {
                        const active = isProjectActive(project.project_end)
                        const color = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                        const label = active === null ? 'Unknown' : active ? 'Active' : 'Inactive'
                        return (
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`}
                            title={label}
                          />
                        )
                      })()}
                      <span className="truncate">{project.org_name}</span>
                      {project.org_state && <span className="flex-shrink-0">• {project.org_state}</span>}
                      {project.fiscal_year && <span className="flex-shrink-0">• FY{project.fiscal_year}</span>}
                    </div>
                    {(project.pi_names || project.program_officer) && (
                      <p className="text-xs text-gray-500 mt-1.5 truncate">
                        {project.pi_names && <>PI: {project.pi_names.split(';')[0]?.trim()}</>}
                        {project.pi_names && project.program_officer && <span className="mx-1">•</span>}
                        {project.program_officer && <>PO: {project.program_officer}</>}
                      </p>
                    )}
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
                      {project.clinical_trial_count > 0 && (
                        <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                          {project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}
                        </span>
                      )}
                      {project.publication_count > 0 && (
                        <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                          {project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </button>
                )
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (latestResult.name === 'search_projects') {
    // Now returns KeywordSearchResult format from hybrid search
    // Use displayData if available (for filtered results), otherwise fall back to raw data
    const data = displayData || latestResult.data as KeywordSearchResult

    const isCapped = data.showing_count && data.showing_count < data.total_count
    const isFiltered = filteredResults !== null

    return (
      <div className={`overflow-y-auto ${isMobile ? '' : 'h-full'}`}>
        {/* Stats section - hidden in two-column mode */}
        {!hideStatsAndFilters && (
        <div className={`${isMobile ? 'p-4' : 'p-6'} border-b border-gray-100`}>
          <div className={`${isMobile ? 'text-3xl' : 'text-4xl'} font-semibold tracking-tight text-gray-900`}>{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">
            projects found{isCapped && ` · showing top ${data.showing_count}`}
            {isFiltered && ' (filtered)'}
          </div>
          {searchContext && (
            <div className="text-xs text-gray-400 mt-2 truncate" title={`Keyword: ${searchContext.keywordQuery}\nSemantic: ${searchContext.semanticQuery}`}>
              Searched: {searchContext.semanticQuery || searchContext.keywordQuery}
            </div>
          )}
          {/* Precision filter - hidden on desktop when shown in middle column */}
          {!stickyFilters && onPrecisionChange && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1.5">Match quality</div>
              <div className="flex gap-1.5">
                {[
                  { level: 'low' as const, label: 'Broad', count: precisionCounts?.low },
                  { level: 'med' as const, label: 'Balanced', count: precisionCounts?.med },
                  { level: 'high' as const, label: 'Precise', count: precisionCounts?.high },
                ].map(({ level, label, count }) => {
                  const isSelected = precision === level
                  return (
                    <button
                      key={level}
                      onClick={() => onPrecisionChange(level)}
                      className={`
                        px-2.5 py-1 text-xs rounded-full border transition-all
                        ${isSelected
                          ? 'bg-indigo-500 text-white border-indigo-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                        }
                      `}
                    >
                      {label}
                      {count !== undefined && (
                        <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                          {count}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Filter Chips - sticky and collapsible on desktop - hidden in two-column mode */}
        {!hideStatsAndFilters && searchContext && data.all_results?.length > 0 && (
          <div className={`${stickyFilters ? 'sticky top-0 z-10 bg-white shadow-sm' : ''} ${isMobile ? 'p-4' : 'p-4'} border-b border-gray-100`}>
            {stickyFilters && (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFiltersCollapsed(!filtersCollapsed)}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {filtersCollapsed ? 'Show' : 'Hide'}
                  </button>
                  <span className="text-gray-300">·</span>
                  <span className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider">Filter Results</span>
                  {filtersCollapsed && activeFilterCount > 0 && (
                    <span className="text-xs text-gray-500">
                      ({activeFilterCount} active)
                    </span>
                  )}
                </div>
                {activeFilterCount > 0 && (
                  <button
                    onClick={() => onFilterChange({})}
                    className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            <div className={stickyFilters && filtersCollapsed ? 'hidden' : ''}>
              <FilterChips
                byCategory={searchContext.originalResults.by_category || {}}
                byOrgType={searchContext.originalResults.by_org_type || {}}
                filteredByCategory={crossFilteredByCategory}
                filteredByOrgType={crossFilteredByOrgType}
                quickFilterCounts={quickFilterCounts}
                keywordQuery={searchContext.keywordQuery}
                semanticQuery={searchContext.semanticQuery}
                onFilterChange={onFilterChange}
                isLoading={false}
                hideHeader={stickyFilters}
              />
            </div>
          </div>
        )}

        {data.all_results?.length > 0 && (
          <div className={isMobile ? 'p-4' : 'p-6'}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider">
                {persona === 'bd' ? 'Contacts' : 'Most Relevant'}
              </h3>
              <button
                onClick={() => exportToCSV(data.all_results)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 hover:text-[#E07A5F] hover:bg-gray-50 rounded transition-colors"
                title="Export to CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>
            <div className={isMobile ? 'space-y-3' : 'space-y-5'}>
              {data.all_results.slice(0, isMobile ? 50 : 100).map((project) => (
                persona === 'bd' ? (
                  // People-focused layout: org and PI names are clickable links
                  <div
                    key={project.application_id}
                    className={isMobile
                      ? 'bg-white rounded-xl p-4 shadow-sm border border-gray-100'
                      : 'pb-4 border-b border-gray-50 last:border-0 last:pb-0 -mx-2 px-2 rounded-lg'}
                  >
                    <div className={`flex items-start justify-between ${isMobile ? 'gap-2' : 'gap-3'} mb-1`}>
                      {project.org_name ? (
                        <button
                          onClick={() => onOrgClick?.(project.org_name!)}
                          className="text-sm font-medium text-gray-900 leading-snug flex-1 break-words hover:text-[#E07A5F] transition-colors text-left"
                        >
                          {project.org_name}
                        </button>
                      ) : (
                        <span className="text-sm font-medium text-gray-900 leading-snug flex-1 break-words">
                          Unknown Organization
                        </span>
                      )}
                      {project.total_cost && (
                        <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                          {formatCurrency(project.total_cost)}
                        </span>
                      )}
                    </div>
                    {project.pi_names && (
                      <button
                        onClick={() => onResearcherClick?.(project.pi_names!.split(';')[0]?.trim() || '')}
                        className="text-sm text-gray-700 mt-1 block hover:text-[#E07A5F] transition-colors text-left"
                      >
                        {project.pi_names.split(';')[0]?.trim()}
                      </button>
                    )}
                    <button
                      onClick={() => onProjectClick?.(project.application_id)}
                      className="text-xs text-gray-500 mt-2 line-clamp-2 text-left hover:text-[#E07A5F] transition-colors"
                    >
                      {project.title}
                    </button>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                      {(() => {
                        const active = isProjectActive(project.project_end)
                        const color = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                        const label = active === null ? 'Unknown' : active ? 'Active' : 'Inactive'
                        return (
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`}
                            title={label}
                          />
                        )
                      })()}
                      {project.org_state && <span>{project.org_state}</span>}
                      {project.primary_category && (
                        <span className="capitalize">{project.primary_category.replace(/_/g, ' ')}</span>
                      )}
                      {project.patent_count > 0 && (
                        <span>{project.patent_count} Patent{project.patent_count !== 1 ? 's' : ''}</span>
                      )}
                      {project.publication_count > 0 && (
                        <span>{project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    key={project.application_id}
                    onClick={() => onProjectClick?.(project.application_id)}
                    className={`group block w-full text-left ${isMobile
                      ? 'bg-white rounded-xl p-4 shadow-sm border border-gray-100 active:bg-gray-50'
                      : 'pb-4 border-b border-gray-50 last:border-0 last:pb-0 hover:bg-gray-50/50 -mx-2 px-2 rounded-lg transition-colors'}`}
                  >
                    <div className={`flex items-start justify-between ${isMobile ? 'gap-2' : 'gap-3'} mb-2`}>
                      <span className="text-sm text-gray-900 leading-snug flex-1 break-words group-hover:text-[#E07A5F] transition-colors">
                        {project.title}
                      </span>
                      {project.total_cost && (
                        <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap">
                          {formatCurrency(project.total_cost)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {(() => {
                        const active = isProjectActive(project.project_end)
                        const color = active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                        const label = active === null ? 'Unknown' : active ? 'Active' : 'Inactive'
                        return (
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`}
                            title={label}
                          />
                        )
                      })()}
                      <span className="truncate">{project.org_name}</span>
                      {project.org_state && <span className="flex-shrink-0">• {project.org_state}</span>}
                      {project.fiscal_year && <span className="flex-shrink-0">• FY{project.fiscal_year}</span>}
                    </div>
                    {(project.pi_names || project.program_officer) && (
                      <p className="text-xs text-gray-500 mt-1.5 truncate">
                        {project.pi_names && <>PI: {project.pi_names.split(';')[0]?.trim()}</>}
                        {project.pi_names && project.program_officer && <span className="mx-1">•</span>}
                        {project.program_officer && <>PO: {project.program_officer}</>}
                      </p>
                    )}
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
                      {project.clinical_trial_count > 0 && (
                        <span className="px-2 py-0.5 text-xs bg-green-50 text-green-700 rounded">
                          {project.clinical_trial_count} Trial{project.clinical_trial_count !== 1 ? 's' : ''}
                        </span>
                      )}
                      {project.publication_count > 0 && (
                        <span className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                          {project.publication_count} Pub{project.publication_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </button>
                )
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (latestResult.name === 'search_patents') {
    const data = latestResult.data as Array<{
      patent_id: string
      patent_title: string
      project_number: string | null
      similarity?: number
    }>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.length}</div>
          <div className="text-sm text-gray-400 mt-1">patents found</div>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            {data.map((patent) => (
              <div key={patent.patent_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="text-sm text-gray-900 leading-snug flex-1">{patent.patent_title}</p>
                  {patent.similarity && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {Math.round(patent.similarity * 100)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>US{patent.patent_id}</span>
                  {patent.project_number && <span>• NIH {patent.project_number}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (latestResult.name === 'search_trials') {
    const data = latestResult.data as TrialSearchResult

    const actualCount = data.all_results.length
    const isCapped = data.total_count > actualCount

    return (
      <div className={`overflow-y-auto ${isMobile ? '' : 'h-full'}`}>
        {/* Stats section - hidden when displayed in left column */}
        {!hideStatsAndFilters && (
          <div className={`${isMobile ? 'p-4' : 'p-6'} border-b border-gray-100`}>
            <div className={`${isMobile ? 'text-3xl' : 'text-4xl'} font-semibold tracking-tight text-gray-900`}>{actualCount.toLocaleString()}</div>
            <div className="text-sm text-gray-400 mt-1">
              clinical trials found{isCapped && ` · ${data.total_count.toLocaleString()} total matches`}
            </div>
            {data.search_query && (
              <div className="text-xs text-gray-400 mt-2 truncate" title={data.search_query}>
                Searched: {data.search_query}
              </div>
            )}
          </div>
        )}

        {/* Status breakdown - clickable filters (hidden when displayed in left column) */}
        {!hideStatsAndFilters && (() => {
          // Compute counts from all_results to match what's actually available
          const statusCounts: Record<string, number> = {}
          data.all_results.forEach(t => {
            const status = t.study_status || 'UNKNOWN'
            statusCounts[status] = (statusCounts[status] || 0) + 1
          })
          const sortedStatuses = Object.entries(statusCounts).sort(([, a], [, b]) => b - a)

          if (sortedStatuses.length === 0) return null

          return (
            <div className={`${isMobile ? 'p-4' : 'p-6'} border-b border-gray-100`}>
              <h3 className="text-xs text-gray-500 mb-2">Trial Status</h3>
              <div className="flex flex-wrap gap-2">
                {sortedStatuses.slice(0, 6).map(([status, count]) => {
                  const isSelected = trialStatusFilters.includes(status)
                  return (
                    <button
                      key={status}
                      onClick={() => {
                        if (onTrialStatusChange) {
                          if (isSelected) {
                            onTrialStatusChange(trialStatusFilters.filter(s => s !== status))
                          } else {
                            onTrialStatusChange([...trialStatusFilters, status])
                          }
                        }
                      }}
                      className={`
                        px-3 py-1.5 text-xs rounded-full border transition-all
                        ${isSelected
                          ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#E07A5F]'
                        }
                      `}
                    >
                      <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                      <span className={`ml-1.5 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 text-xs text-gray-500">
                {data.by_type.therapeutic} therapeutic · {data.by_type.diagnostic} diagnostic
              </div>
            </div>
          )
        })()}

        {/* Trial results - filtered by status if filters active */}
        {(() => {
          const filteredTrials = trialStatusFilters.length > 0
            ? data.all_results.filter(t => t.study_status && trialStatusFilters.includes(t.study_status))
            : data.all_results
          const displayCount = filteredTrials.length

          return filteredTrials.length > 0 && (
            <div className={isMobile ? 'p-4' : 'p-6'}>
              <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-4">
                {trialStatusFilters.length > 0 ? `${displayCount} Filtered Trials` : 'Top Trials'}
              </h3>
              <div className={isMobile ? 'space-y-3' : 'space-y-5'}>
                {filteredTrials.slice(0, isMobile ? 30 : 50).map((trial) => {
                  const isSaved = savedTrialIds.has(trial.nct_id)
                  return (
                    <div
                      key={trial.id}
                      className={`${isMobile
                        ? 'bg-white rounded-xl p-4 shadow-sm border border-gray-100'
                        : 'pb-4 border-b border-gray-50 last:border-0 last:pb-0'}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <button
                          onClick={() => onTrialClick?.(trial.nct_id)}
                          className="text-sm text-gray-900 leading-snug flex-1 hover:text-[#E07A5F] transition-colors text-left"
                        >
                          {trial.study_title}
                        </button>
                        {onSaveTrial && (
                          <button
                            onClick={() => onSaveTrial(trial.nct_id)}
                            className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                              isSaved
                                ? 'text-[#E07A5F] bg-orange-50'
                                : 'text-gray-400 hover:text-[#E07A5F] hover:bg-orange-50'
                            }`}
                            title={isSaved ? 'Remove from saved' : 'Save trial'}
                          >
                            <Bookmark
                              className="w-4 h-4"
                              fill={isSaved ? 'currentColor' : 'none'}
                              strokeWidth={1.5}
                            />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                        <a
                          href={`https://clinicaltrials.gov/study/${trial.nct_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#E07A5F] hover:underline font-medium"
                        >
                          {trial.nct_id}
                        </a>
                        {trial.study_status && (
                          <>
                            <span>•</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${
                              trial.study_status === 'RECRUITING' ? 'bg-green-50 text-green-700' :
                              trial.study_status === 'COMPLETED' ? 'bg-blue-50 text-blue-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {trial.study_status.replace(/_/g, ' ')}
                            </span>
                          </>
                        )}
                        {trial.phase && (
                          <>
                            <span>•</span>
                            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                              {trial.phase.replace('PHASE', 'Phase ').replace('EARLY_PHASE1', 'Early Phase 1').replace('NA', 'N/A')}
                            </span>
                          </>
                        )}
                        {trial.enrollment_count && (
                          <>
                            <span>•</span>
                            <span className="text-gray-500">
                              {trial.enrollment_count.toLocaleString()} enrolled
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5">
                        {trial.is_therapeutic_trial && (
                          <span className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded">
                            Therapeutic
                          </span>
                        )}
                        {trial.is_diagnostic_trial && (
                          <span className="px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded">
                            Diagnostic
                          </span>
                        )}
                        {trial.org_name && (
                          <span className="text-xs text-gray-500">
                            {trial.org_name}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  if (latestResult.name === 'get_company_profile') {
    const data = latestResult.data as {
      org_name: string
      total_funding: number
      project_count: number
      patent_count: number
      publication_count: number
      clinical_trial_count: number
      top_projects: Array<{ title: string; total_cost: number | null; fiscal_year: number | null }>
    }

    if (!data) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Not found</div>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-lg font-semibold text-gray-900">{data.org_name}</div>
          <div className="text-3xl font-semibold tracking-tight text-[#E07A5F] mt-2">{formatCurrency(data.total_funding)}</div>
          <div className="text-sm text-gray-400 mt-1">total funding</div>
        </div>

        <div className="grid grid-cols-2 gap-6 p-6 border-b border-gray-100">
          {[
            { label: 'Projects', value: data.project_count },
            { label: 'Patents', value: data.patent_count },
            { label: 'Publications', value: data.publication_count },
            { label: 'Trials', value: data.clinical_trial_count },
          ].map(stat => (
            <div key={stat.label}>
              <div className="text-2xl font-semibold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {data.top_projects?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-4">Recent Projects</h3>
            <div className="space-y-4">
              {data.top_projects.map((project, idx) => (
                <div key={idx}>
                  <p className="text-sm text-gray-900">{project.title}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-400">FY{project.fiscal_year}</span>
                    {project.total_cost && (
                      <span className="text-sm font-medium text-[#E07A5F]">{formatCurrency(project.total_cost)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (latestResult.name === 'get_patent_details') {
    const data = latestResult.data as {
      patent_id: string
      patent_title: string
      patent_abstract: string | null
      patent_date: string | null
      assignees: string[]
      inventors: string[]
      cited_by_count: number
    }

    if (!data) return <div className="flex items-center justify-center h-full text-gray-400 text-sm">Not found</div>

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-xs text-gray-400 mb-2">US{data.patent_id}</div>
          <div className="text-lg font-semibold text-gray-900 leading-snug">{data.patent_title}</div>
          {data.patent_date && <div className="text-sm text-gray-400 mt-2">Filed {data.patent_date}</div>}
        </div>

        {data.patent_abstract && (
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Abstract</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.patent_abstract}</p>
          </div>
        )}

        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Cited by</span>
            <span className="text-xl font-semibold text-gray-900">{data.cited_by_count}</span>
          </div>
        </div>

        {data.assignees?.length > 0 && (
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Assignees</h3>
            {data.assignees.map((a, i) => <p key={i} className="text-sm text-gray-600">{a}</p>)}
          </div>
        )}

        {data.inventors?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Inventors</h3>
            <div className="flex flex-wrap gap-2">
              {data.inventors.map((inv, i) => (
                <span key={i} className="px-3 py-1.5 bg-gray-50 rounded-full text-sm text-gray-600">{inv}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <pre className="text-xs text-gray-500 whitespace-pre-wrap">{JSON.stringify(latestResult.data, null, 2)}</pre>
    </div>
  )
}

export function Chat({ persona, initialQuery }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [toolResults, setToolResults] = useState<ToolResult[]>([])
  const [searchContext, setSearchContext] = useState<SearchContext | null>(null)
  const [filteredResults, setFilteredResults] = useState<KeywordSearchResult | null>(null)
  const [currentFilters, setCurrentFilters] = useState<FilterState>({})
  const [trialStatusFilters, setTrialStatusFilters] = useState<string[]>([])
  const [savedTrialIds, setSavedTrialIds] = useState<Set<string>>(new Set())
  const [precision, setPrecision] = useState<'low' | 'med' | 'high'>('low')
  const [restoredFromStorage, setRestoredFromStorage] = useState(false)
  const [showMobileResults, setShowMobileResults] = useState(true)  // Delay mobile results during restoration
  const [initialQueryProcessed, setInitialQueryProcessed] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isRestoringState = useRef(false)
  const prevPersonaRef = useRef<PersonaType | null>(null)

  const router = useRouter()
  const metadata = PERSONA_METADATA[persona]
  const IconComponent = ICONS[metadata.icon]

  // Restore search state from sessionStorage on mount
  useEffect(() => {
    // Disable browser's automatic scroll restoration - but NOT on iOS Safari
    // iOS Safari doesn't handle manual scroll restoration well
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (!isIOS && 'scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }

    const saved = sessionStorage.getItem('searchState')
    if (saved) {
      try {
        isRestoringState.current = true
        // Hide mobile results initially to prevent scroll-to-bottom
        setShowMobileResults(false)
        const state = JSON.parse(saved)
        if (state.toolResults) setToolResults(state.toolResults)
        if (state.searchContext) setSearchContext(state.searchContext)
        if (state.filteredResults) setFilteredResults(state.filteredResults)
        if (state.currentFilters) setCurrentFilters(state.currentFilters)
        if (state.messages) setMessages(state.messages)
        // Clear after restoring so refresh doesn't restore again
        sessionStorage.removeItem('searchState')
        // Mark as restored - this triggers useLayoutEffect to scroll
        setRestoredFromStorage(true)
      } catch (e) {
        console.error('Failed to restore search state:', e)
        isRestoringState.current = false
        setShowMobileResults(true)
      }
    }
  }, [])

  // Scroll to top after state restoration
  // Uses Safari-compatible timing pattern: RAF → setTimeout(0) → scrollTop
  useLayoutEffect(() => {
    if (restoredFromStorage && toolResults.length > 0 && messagesContainerRef.current) {
      const container = messagesContainerRef.current

      // Safari-compatible scroll function using proper timing pattern
      const scrollToTop = () => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            container.scrollTop = 0
          }, 0)
        })
      }

      // Scroll immediately
      container.scrollTop = 0
      scrollToTop()

      // Show results after a brief delay, then scroll again
      const showResultsTimer = setTimeout(() => {
        setShowMobileResults(true)
        // Scroll after React renders the results
        scrollToTop()
      }, 100)

      // Additional scroll attempts after results render
      const scrollTimers = [150, 200, 300, 500, 1000].map(delay =>
        setTimeout(() => {
          container.scrollTop = 0
          if (delay === 1000) {
            isRestoringState.current = false
          }
        }, delay)
      )

      return () => {
        clearTimeout(showResultsTimer)
        scrollTimers.forEach(t => clearTimeout(t))
      }
    }
  }, [restoredFromStorage, toolResults])

  // Reset state when persona changes (but not on first mount or restoration)
  useEffect(() => {
    const prevPersona = prevPersonaRef.current
    prevPersonaRef.current = persona

    // Skip on first mount - let restoration effect handle it
    if (prevPersona === null) {
      return
    }

    // Only clear state when persona actually changes
    if (prevPersona !== persona) {
      setMessages([])
      setInput('')
      setToolResults([])
      setSearchContext(null)
      setFilteredResults(null)
      setCurrentFilters({})
      setTrialStatusFilters([])
      setRestoredFromStorage(false)
      setShowMobileResults(true)
      // Reset initialQueryProcessed so auto-submit will re-trigger with new persona
      setInitialQueryProcessed(false)
      // Clear sessionStorage to prevent stale state restoration
      sessionStorage.removeItem('searchState')
    }
  }, [persona])

  // Save search state and navigate to project
  const navigateToProject = useCallback((applicationId: string) => {
    // Scroll to top BEFORE navigating so iOS Safari remembers this position
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0
    }

    const state = {
      toolResults,
      searchContext,
      filteredResults,
      currentFilters,
      messages,
      returnUrl: window.location.href
    }
    sessionStorage.setItem('searchState', JSON.stringify(state))
    router.push(`/project/${applicationId}`)
  }, [toolResults, searchContext, filteredResults, currentFilters, messages, router])

  // Save search state and navigate to trial
  const navigateToTrial = useCallback((nctId: string) => {
    // Scroll to top BEFORE navigating so iOS Safari remembers this position
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0
    }

    const state = {
      toolResults,
      searchContext,
      filteredResults,
      currentFilters,
      messages,
      returnUrl: window.location.href
    }
    sessionStorage.setItem('searchState', JSON.stringify(state))
    router.push(`/trial/${nctId}`)
  }, [toolResults, searchContext, filteredResults, currentFilters, messages, router])

  // Save search state and navigate to organization
  const navigateToOrg = useCallback((orgName: string) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0
    }

    const state = {
      toolResults,
      searchContext,
      filteredResults,
      currentFilters,
      messages,
      returnUrl: window.location.href
    }
    sessionStorage.setItem('searchState', JSON.stringify(state))
    router.push(`/org/${encodeURIComponent(orgName)}`)
  }, [toolResults, searchContext, filteredResults, currentFilters, messages, router])

  // Save search state and navigate to researcher
  const navigateToResearcher = useCallback((researcherName: string) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = 0
    }

    const state = {
      toolResults,
      searchContext,
      filteredResults,
      currentFilters,
      messages,
      returnUrl: window.location.href
    }
    sessionStorage.setItem('searchState', JSON.stringify(state))
    router.push(`/researcher/${encodeURIComponent(researcherName)}`)
  }, [toolResults, searchContext, filteredResults, currentFilters, messages, router])

  // Save/unsave trial
  const handleSaveTrial = useCallback(async (nctId: string) => {
    const isSaved = savedTrialIds.has(nctId)

    // Optimistic update
    setSavedTrialIds(prev => {
      const next = new Set(prev)
      if (isSaved) {
        next.delete(nctId)
      } else {
        next.add(nctId)
      }
      return next
    })

    try {
      if (isSaved) {
        await fetch(`/api/saved-trials?nct_id=${nctId}`, { method: 'DELETE' })
      } else {
        await fetch('/api/saved-trials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nct_id: nctId })
        })
      }
    } catch (e) {
      // Revert on error
      setSavedTrialIds(prev => {
        const next = new Set(prev)
        if (isSaved) {
          next.add(nctId)
        } else {
          next.delete(nctId)
        }
        return next
      })
      console.error('Error saving trial:', e)
    }
  }, [savedTrialIds])

  // Helper to check if project is SBIR/STTR (memoized to prevent infinite re-renders)
  const isSbirSttr = useCallback((activityCode: string | null | undefined): boolean => {
    const { isSbir, isSttr } = getSbirSttrStatus(activityCode)
    return isSbir || isSttr
  }, [])

  // Handle filter changes - filter client-side from stored results
  const handleFilterChange = useCallback((filters: FilterState) => {
    setCurrentFilters(filters)

    if (!searchContext) return

    const allResults = searchContext.originalResults.all_results
    const quick = filters.quick

    // If no filters, clear filtered results and show original
    const hasQuickFilters = quick && (quick.activeOnly || quick.sbirSttrOnly || quick.hasPatents || quick.hasClinicalTrials || quick.precision)
    if (!filters.primary_category?.length && !filters.org_type?.length && !hasQuickFilters) {
      setFilteredResults(null)
      return
    }

    // Filter the full result set client-side
    let filtered = allResults

    // Apply precision filter (percentile-based: top N% by similarity)
    if (quick?.precision) {
      const percentile = PRECISION_PERCENTILES[quick.precision]
      const sorted = [...filtered].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      const count = Math.max(1, Math.ceil(sorted.length * percentile))
      filtered = sorted.slice(0, count)
    }

    // Apply quick filters
    if (quick?.activeOnly) {
      filtered = filtered.filter(p => isProjectActive(p.project_end) === true)
    }
    if (quick?.sbirSttrOnly) {
      filtered = filtered.filter(p => isSbirSttr(p.activity_code))
    }
    if (quick?.hasPatents) {
      filtered = filtered.filter(p => (p.patent_count || 0) > 0)
    }
    if (quick?.hasClinicalTrials) {
      filtered = filtered.filter(p => (p.clinical_trial_count || 0) > 0)
    }

    if (filters.primary_category?.length) {
      filtered = filtered.filter(p =>
        p.primary_category && filters.primary_category!.includes(p.primary_category)
      )
    }

    if (filters.org_type?.length) {
      filtered = filtered.filter(p =>
        p.org_type && filters.org_type!.includes(p.org_type)
      )
    }

    // Recalculate category and org_type counts from filtered set
    const byCategory: Record<string, number> = {}
    const byOrgType: Record<string, number> = {}

    filtered.forEach(p => {
      const cat = p.primary_category || 'other'
      const org = p.org_type || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    // Build filtered result with updated counts
    const filteredData: KeywordSearchResult = {
      summary: `Found ${filtered.length} projects (filtered).`,
      search_query: searchContext.originalResults.search_query,
      total_count: filtered.length,
      showing_count: Math.min(filtered.length, 100),
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: filtered,
      sample_results: filtered.slice(0, 10)
    }

    setFilteredResults(filteredData)
  }, [searchContext])

  // Apply precision filtering when precision changes
  useEffect(() => {
    if (!searchContext) return

    const allResults = searchContext.originalResults.all_results
    const percentile = PRECISION_PERCENTILES[precision]

    // Filter by percentile (top N% by similarity)
    const sorted = [...allResults].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    const count = Math.max(1, Math.ceil(sorted.length * percentile))
    let filtered = sorted.slice(0, count)

    // Also apply any existing category/org_type filters
    if (currentFilters.primary_category?.length) {
      filtered = filtered.filter(p =>
        p.primary_category && currentFilters.primary_category!.includes(p.primary_category)
      )
    }
    if (currentFilters.org_type?.length) {
      filtered = filtered.filter(p =>
        p.org_type && currentFilters.org_type!.includes(p.org_type)
      )
    }
    // Apply quick filters
    const quick = currentFilters.quick
    if (quick?.activeOnly) {
      filtered = filtered.filter(p => isProjectActive(p.project_end) === true)
    }
    if (quick?.sbirSttrOnly) {
      filtered = filtered.filter(p => isSbirSttr(p.activity_code))
    }
    if (quick?.hasPatents) {
      filtered = filtered.filter(p => (p.patent_count || 0) > 0)
    }
    if (quick?.hasClinicalTrials) {
      filtered = filtered.filter(p => (p.clinical_trial_count || 0) > 0)
    }

    // Recalculate counts
    const byCategory: Record<string, number> = {}
    const byOrgType: Record<string, number> = {}
    filtered.forEach(p => {
      const cat = p.primary_category || 'other'
      const org = p.org_type || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    const filteredData: KeywordSearchResult = {
      summary: `Found ${filtered.length} projects.`,
      search_query: searchContext.originalResults.search_query,
      total_count: filtered.length,
      showing_count: Math.min(filtered.length, 100),
      by_category: byCategory,
      by_org_type: byOrgType,
      all_results: filtered,
      sample_results: filtered.slice(0, 10)
    }

    setFilteredResults(filteredData)
  }, [precision, searchContext, currentFilters, isSbirSttr])

  // Compute precision counts from original results (percentile-based)
  const precisionCounts = useMemo(() => {
    if (!searchContext) return undefined
    const total = searchContext.originalResults.all_results.length
    return {
      low: total,  // 100% - all results
      med: Math.max(1, Math.ceil(total * PRECISION_PERCENTILES.med)),   // Top 50%
      high: Math.max(1, Math.ceil(total * PRECISION_PERCENTILES.high))  // Top 20%
    }
  }, [searchContext])

  useEffect(() => {
    // Don't auto-scroll when restoring state from sessionStorage
    if (isRestoringState.current) {
      return
    }
    // Only scroll if there are messages (skip on initial empty state)
    // Scroll so messagesEndRef is at BOTTOM of viewport - this keeps messages visible
    // and positions the results panel just below the fold
    if (messages.length > 0 && messagesContainerRef.current && messagesEndRef.current) {
      const container = messagesContainerRef.current
      const endElement = messagesEndRef.current
      // Get position relative to scroll container
      const containerRect = container.getBoundingClientRect()
      const endRect = endElement.getBoundingClientRect()
      // Calculate scroll to put messagesEndRef at bottom of visible area
      // (current scroll + element position relative to container - container height)
      const scrollTarget = container.scrollTop + (endRect.bottom - containerRect.bottom)
      container.scrollTop = Math.max(0, scrollTarget)
    }
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const sendMessage = useCallback(async (text: string, currentMessages: Message[]) => {
    if (!text.trim() || isLoading) return

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim() }
    const updatedMessages = [...currentMessages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setIsLoading(true)
    // Clear tool results when starting a new user message (not on each tool_start)
    setToolResults([])

    const assistantId = crypto.randomUUID()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages.map(m => ({ role: m.role, content: m.content })), persona })
      })

      if (!response.ok) throw new Error('Chat request failed')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) throw new Error('No response body')

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
              continue
            }

            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + parsed.content } : m))
              } else if (parsed.type === 'tool_start') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isToolCall: true } : m))
                setIsSearching(true)
              } else if (parsed.type === 'tool_result') {
                setToolResults(prev => [...prev, { name: parsed.name, data: parsed.data, timestamp: Date.now() }])
                setIsSearching(false)
                // Capture search context for UI filtering
                if (parsed.name === 'search_projects' || parsed.name === 'keyword_search') {
                  const resultData = parsed.data as KeywordSearchResult
                  setSearchContext({
                    keywordQuery: resultData.search_query || '',
                    semanticQuery: resultData.search_query || '', // Same for legacy; new dual-query will differentiate
                    originalResults: resultData
                  })
                  setFilteredResults(null) // Clear any previous filters
                } else if (parsed.name === 'search_trials') {
                  // Cast trial results to KeywordSearchResult for searchContext compatibility
                  const resultData = parsed.data as TrialSearchResult
                  setSearchContext({
                    keywordQuery: resultData.search_query || '',
                    semanticQuery: resultData.search_query || '',
                    originalResults: resultData as unknown as KeywordSearchResult
                  })
                  setTrialStatusFilters([]) // Clear any previous trial filters
                }
              } else if (parsed.type === 'tool_complete') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isToolCall: false } : m))
                setIsSearching(false)
              } else if (parsed.type === 'error') {
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${parsed.error}`, isStreaming: false } : m))
                setIsSearching(false)
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Sorry, an error occurred.', isStreaming: false } : m))
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, persona])

  // Auto-submit initial query from welcome screen
  // Don't re-search if we're restoring state from sessionStorage (back button navigation)
  useEffect(() => {
    // Use ref check (isRestoringState) instead of state because refs update immediately
    // This prevents re-searching when navigating back from a project detail page
    if (initialQuery && !initialQueryProcessed && !isLoading && messages.length === 0 && !isRestoringState.current) {
      setInitialQueryProcessed(true)
      sendMessage(initialQuery, [])
    }
  }, [initialQuery, initialQueryProcessed, isLoading, messages.length, sendMessage])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input, messages)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input, messages)
    }
  }

  const handleExampleClick = (query: string) => {
    setInput(query)
    inputRef.current?.focus()
  }

  const handleChoiceClick = (choice: string) => {
    if (!isLoading) sendMessage(choice, messages)
  }

  const isLastAssistantMessage = (messageId: string) => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    return lastAssistant?.id === messageId
  }

  // Helper to apply filters to results (excluding specified filter types for cross-counting)
  const applyFilters = useCallback((
    results: SearchResultProject[],
    filters: FilterState,
    exclude?: { category?: boolean; orgType?: boolean; quick?: keyof QuickFilters }
  ): SearchResultProject[] => {
    let filtered: SearchResultProject[] = results

    // Apply quick filters (unless excluded)
    const quick = filters.quick

    // Apply precision filter (percentile-based, unless excluded)
    if (quick?.precision && exclude?.quick !== 'precision') {
      const percentile = PRECISION_PERCENTILES[quick.precision]
      const sorted = [...filtered].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      const count = Math.max(1, Math.ceil(sorted.length * percentile))
      filtered = sorted.slice(0, count)
    }

    if (quick?.activeOnly && exclude?.quick !== 'activeOnly') {
      filtered = filtered.filter(p => isProjectActive(p.project_end) === true)
    }
    if (quick?.sbirSttrOnly && exclude?.quick !== 'sbirSttrOnly') {
      filtered = filtered.filter(p => isSbirSttr(p.activity_code))
    }
    if (quick?.hasPatents && exclude?.quick !== 'hasPatents') {
      filtered = filtered.filter(p => (p.patent_count || 0) > 0)
    }
    if (quick?.hasClinicalTrials && exclude?.quick !== 'hasClinicalTrials') {
      filtered = filtered.filter(p => (p.clinical_trial_count || 0) > 0)
    }

    // Apply category filter (unless excluded)
    if (filters.primary_category?.length && !exclude?.category) {
      filtered = filtered.filter(p =>
        p.primary_category && filters.primary_category!.includes(p.primary_category)
      )
    }

    // Apply org_type filter (unless excluded)
    if (filters.org_type?.length && !exclude?.orgType) {
      filtered = filtered.filter(p =>
        p.org_type && filters.org_type!.includes(p.org_type)
      )
    }

    return filtered
  }, [isSbirSttr])

  // Compute all cross-filtered counts dynamically (respects precision filter)
  const { crossFilteredByCategory, crossFilteredByOrgType, quickFilterCounts } = useMemo(() => {
    if (!searchContext) {
      return { crossFilteredByCategory: undefined, crossFilteredByOrgType: undefined, quickFilterCounts: undefined }
    }

    const originalResults = searchContext.originalResults.all_results

    // First apply precision filter to get the base set
    const percentile = PRECISION_PERCENTILES[precision]
    const sorted = [...originalResults].sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    const precisionCount = Math.max(1, Math.ceil(sorted.length * percentile))
    const allResults = sorted.slice(0, precisionCount)

    const hasCategory = currentFilters.primary_category?.length
    const hasOrgType = currentFilters.org_type?.length
    const hasQuickFilters = currentFilters.quick && Object.values(currentFilters.quick).some(Boolean)
    const hasPrecision = precision !== 'low'  // 'low' = all results, so not a filter
    const hasAnyFilter = hasCategory || hasOrgType || hasQuickFilters || hasPrecision

    // For category chips: apply all filters EXCEPT category (on precision-filtered set)
    const categoryFiltered = applyFilters(allResults, currentFilters, { category: true })
    const byCategory: Record<string, number> = {}
    categoryFiltered.forEach(p => {
      const cat = p.primary_category || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
    })

    // For org_type chips: apply all filters EXCEPT org_type (on precision-filtered set)
    const orgFiltered = applyFilters(allResults, currentFilters, { orgType: true })
    const byOrgType: Record<string, number> = {}
    orgFiltered.forEach(p => {
      const org = p.org_type || 'other'
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    // For quick filter chips: apply all filters EXCEPT the specific quick filter (on precision-filtered set)
    const activeFiltered = applyFilters(allResults, currentFilters, { quick: 'activeOnly' })
    const sbirFiltered = applyFilters(allResults, currentFilters, { quick: 'sbirSttrOnly' })
    const patentsFiltered = applyFilters(allResults, currentFilters, { quick: 'hasPatents' })
    const trialsFiltered = applyFilters(allResults, currentFilters, { quick: 'hasClinicalTrials' })

    // Precision counts are based on original results (not the filtered set)
    const precisionTotal = originalResults.length
    const quickCounts = {
      active: activeFiltered.filter(p => isProjectActive(p.project_end) === true).length,
      sbirSttr: sbirFiltered.filter(p => isSbirSttr(p.activity_code)).length,
      patents: patentsFiltered.filter(p => (p.patent_count || 0) > 0).length,
      clinicalTrials: trialsFiltered.filter(p => (p.clinical_trial_count || 0) > 0).length,
      precisionLow: precisionTotal,  // 100% - all results
      precisionMed: Math.max(1, Math.ceil(precisionTotal * PRECISION_PERCENTILES.med)),   // Top 50%
      precisionHigh: Math.max(1, Math.ceil(precisionTotal * PRECISION_PERCENTILES.high))  // Top 20%
    }

    return {
      crossFilteredByCategory: hasAnyFilter ? byCategory : undefined,
      crossFilteredByOrgType: hasAnyFilter ? byOrgType : undefined,
      quickFilterCounts: quickCounts
    }
  }, [searchContext, currentFilters, applyFilters, isSbirSttr, precision])

  // Get the last assistant message for the search summary
  const lastAssistantMsg = messages.filter(m => m.role === 'assistant' && !m.isToolCall).pop()
  const userQuery = messages.find(m => m.role === 'user')?.content

  return (
    <div className="h-full bg-white flex flex-col overflow-hidden max-w-full">
      {/* Empty state - centered with input inline */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col justify-center overflow-hidden px-4 lg:px-6 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8">
          <div className="text-center w-full max-w-md mx-auto">
            <div className="flex justify-center mb-4">
              <IconComponent className="w-10 h-10 text-gray-300" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl lg:text-2xl font-semibold tracking-tight text-gray-900 mb-1">
              {metadata.title}
            </h2>
            <p className="text-sm text-[#E07A5F] mb-1">
              &ldquo;{metadata.subtitle}&rdquo;
            </p>
            <p className="text-gray-400 mb-6 text-sm px-2">
              {metadata.description}
            </p>

            {/* Input right after content */}
            <form onSubmit={handleSubmit} className="mb-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, 140))}
                    onKeyDown={handleKeyDown}
                    placeholder={metadata.placeholder || "Ask a question..."}
                    rows={1}
                    maxLength={140}
                    className="w-full px-3 py-3 bg-gray-50 border-0 rounded-xl resize-none text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-base"
                    style={{ maxHeight: '120px' }}
                    disabled={isLoading}
                  />
                  {input.length > 100 && (
                    <span className={`absolute right-3 bottom-2 text-xs ${input.length >= 140 ? 'text-red-400' : 'text-gray-400'}`}>
                      {140 - input.length}
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || input.length > 140}
                  className="flex-shrink-0 p-3 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-40 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </form>

            {metadata.exampleQueries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Try an example</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {metadata.exampleQueries.slice(0, 3).map((query, index) => (
                    <button
                      key={index}
                      onClick={() => handleExampleClick(query)}
                      className="px-3 py-1.5 text-sm bg-white border border-gray-100 rounded-full hover:border-[#E07A5F] hover:shadow-md text-gray-600 transition-all"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Two-column layout: Left (filters) + Right (results) */}
          <div className="flex-1 flex overflow-hidden" ref={messagesContainerRef}>
            <div ref={messagesEndRef} />

            {/* Left column - Search context, stats, filters */}
            <div className="w-80 lg:w-96 flex-shrink-0 border-r border-gray-100 overflow-y-auto bg-[#FAFAF9]">
              <div className="p-5 space-y-4">
                {/* User query */}
                <div className="flex items-start gap-2">
                  <Search className="w-4 h-4 text-[#E07A5F] flex-shrink-0 mt-0.5" />
                  <span className="text-sm font-medium text-gray-900">{userQuery}</span>
                </div>

                {/* Persona switching chips - only show after results load */}
                {toolResults.length > 0 && userQuery && (
                  <div className="flex gap-1.5">
                    {[
                      { key: 'researcher' as const, label: 'Projects' },
                      { key: 'bd' as const, label: 'People' },
                      { key: 'trials' as const, label: 'Trials' },
                    ].map(({ key, label }) => {
                      const isActive = persona === key
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            if (!isActive) {
                              router.push(`/chat?persona=${key}&q=${encodeURIComponent(userQuery)}`)
                            }
                          }}
                          className={`
                            px-3 py-1.5 text-xs rounded-full border transition-all
                            ${isActive
                              ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                              : 'bg-white text-[#E07A5F] border-[#E07A5F] hover:bg-[#E07A5F]/10'
                            }
                          `}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Stats section with match quality */}
                {toolResults.length > 0 && searchContext ? (
                  <div className="pb-4 border-b border-gray-200">
                    <div className="text-3xl font-semibold tracking-tight text-gray-900">
                      {(filteredResults || searchContext.originalResults).total_count.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">
                      {persona === 'trials' ? 'trials' : 'projects'} found
                      {filteredResults && ' (filtered)'}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      Searched: {searchContext.semanticQuery || searchContext.keywordQuery}
                    </div>
                    {/* Match quality chips */}
                    <div className="mt-3">
                      <h4 className="text-xs text-gray-500 mb-1.5">Match Quality</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { level: 'low' as const, label: 'Broad', count: precisionCounts?.low },
                          { level: 'med' as const, label: 'Balanced', count: precisionCounts?.med },
                          { level: 'high' as const, label: 'Precise', count: precisionCounts?.high },
                        ].map(({ level, label, count }) => {
                          const isSelected = precision === level
                          return (
                            <button
                              key={level}
                              onClick={() => setPrecision(level)}
                              className={`
                                px-2.5 py-1 text-xs rounded-full border transition-all
                                ${isSelected
                                  ? 'bg-indigo-500 text-white border-indigo-500'
                                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                                }
                              `}
                            >
                              {label}
                              {count !== undefined && (
                                <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                                  {count}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-3 h-3 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
                    <span>Searching...</span>
                  </div>
                ) : null}

                {/* Filter chips - different for trials vs projects */}
                {toolResults.length > 0 && searchContext && searchContext.originalResults.all_results?.length > 0 && (
                  persona === 'trials' ? (
                    // Trial status filters
                    (() => {
                      const trialResults = searchContext.originalResults as unknown as TrialSearchResult
                      const byStatus = trialResults.by_status || {}
                      const byType = trialResults.by_type || {}
                      const sortedStatuses = Object.entries(byStatus).sort(([, a], [, b]) => (b as number) - (a as number))
                      const hasActiveFilters = trialStatusFilters.length > 0

                      if (sortedStatuses.length === 0) return null

                      return (
                        <div className="space-y-4">
                          {/* Header with clear button */}
                          <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider">
                              Filter Results
                            </h3>
                            {hasActiveFilters && (
                              <button
                                onClick={() => setTrialStatusFilters([])}
                                className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
                              >
                                Clear filters
                              </button>
                            )}
                          </div>

                          {/* Trial status chips */}
                          <div>
                            <h4 className="text-xs text-gray-500 mb-2">Trial Status</h4>
                            <div className="flex flex-wrap gap-2">
                              {sortedStatuses.slice(0, 8).map(([status, count]) => {
                                const isSelected = trialStatusFilters.includes(status)
                                return (
                                  <button
                                    key={status}
                                    onClick={() => {
                                      if (isSelected) {
                                        setTrialStatusFilters(trialStatusFilters.filter(s => s !== status))
                                      } else {
                                        setTrialStatusFilters([...trialStatusFilters, status])
                                      }
                                    }}
                                    className={`
                                      px-3 py-1.5 text-xs rounded-full border transition-all
                                      ${isSelected
                                        ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                                        : 'bg-white text-gray-600 border-gray-200 hover:border-[#E07A5F]'
                                      }
                                    `}
                                  >
                                    <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                                    <span className={`ml-1.5 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                                      {(count as number).toLocaleString()}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>

                          {/* Trial type summary */}
                          {(byType.therapeutic || byType.diagnostic) && (
                            <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                              {byType.therapeutic ? `${byType.therapeutic} therapeutic` : ''}
                              {byType.therapeutic && byType.diagnostic ? ' · ' : ''}
                              {byType.diagnostic ? `${byType.diagnostic} diagnostic` : ''}
                            </div>
                          )}
                        </div>
                      )
                    })()
                  ) : (
                    // Project/People filters
                    <FilterChips
                      byCategory={searchContext.originalResults.by_category || {}}
                      byOrgType={searchContext.originalResults.by_org_type || {}}
                      filteredByCategory={crossFilteredByCategory}
                      filteredByOrgType={crossFilteredByOrgType}
                      quickFilterCounts={quickFilterCounts}
                      keywordQuery={searchContext.keywordQuery}
                      semanticQuery={searchContext.semanticQuery}
                      onFilterChange={handleFilterChange}
                      isLoading={false}
                    />
                  )
                )}
              </div>
            </div>

            {/* Right column - Results only */}
            <div className="flex-1 overflow-hidden">
              {toolResults.length > 0 && showMobileResults ? (
                <ResultsPanel
                  results={toolResults}
                  searchContext={searchContext}
                  filteredResults={filteredResults}
                  onFilterChange={handleFilterChange}
                  crossFilteredByCategory={crossFilteredByCategory}
                  crossFilteredByOrgType={crossFilteredByOrgType}
                  quickFilterCounts={quickFilterCounts}
                  onProjectClick={navigateToProject}
                  onOrgClick={navigateToOrg}
                  onResearcherClick={navigateToResearcher}
                  onTrialClick={navigateToTrial}
                  trialStatusFilters={trialStatusFilters}
                  onTrialStatusChange={setTrialStatusFilters}
                  savedTrialIds={savedTrialIds}
                  onSaveTrial={handleSaveTrial}
                  persona={persona}
                  precision={precision}
                  onPrecisionChange={setPrecision}
                  precisionCounts={precisionCounts}
                  stickyFilters={false}
                  currentFilters={currentFilters}
                  hideStatsAndFilters={true}
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <IconComponent className="w-12 h-12 mx-auto mb-3 opacity-30" strokeWidth={1} />
                    <p className="text-sm">Results will appear here</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
