'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search, TrendingUp, Users, Activity } from 'lucide-react'
import type { PersonaType, KeywordSearchResult } from '@/lib/chat/types'
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

interface ChatProps {
  persona: PersonaType
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
function getSbirSttrStatus(activityCode: string | null | undefined): { isSbir: boolean; isSttr: boolean } {
  if (!activityCode) return { isSbir: false, isSttr: false }
  const code = activityCode.toUpperCase()
  // R41, R42 = SBIR Phase I/II
  // R43, R44 = STTR Phase I/II
  // SB1 = SBIR/STTR (we'll call it SBIR for display)
  const isSbir = code === 'R41' || code === 'R42' || code === 'SB1'
  const isSttr = code === 'R43' || code === 'R44'
  return { isSbir, isSttr }
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
  onFilterChange: (filters: { primary_category?: string[]; org_type?: string[] }) => void
  // Cross-filtered counts for dynamic chip numbers
  crossFilteredByCategory?: Record<string, number>
  crossFilteredByOrgType?: Record<string, number>
  // Navigate to project detail (saves state first)
  onProjectClick?: (applicationId: string) => void
}

function ResultsPanel({ results, searchContext, filteredResults, onFilterChange, crossFilteredByCategory, crossFilteredByOrgType, onProjectClick }: ResultsPanelProps) {
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

  // Prioritize project results over patent results when both exist
  // This ensures "find projects with patents" shows projects (with patent badges), not raw patents
  // Use findLast to get the MOST RECENT search result (in case of multiple searches in one response)
  const projectResult = [...results].reverse().find(r => r.name === 'search_projects' || r.name === 'keyword_search')
  const latestResult = projectResult || results[results.length - 1]

  // Use filtered results if available, otherwise use original
  const displayData = filteredResults || (projectResult?.data as KeywordSearchResult | undefined)

  if (latestResult.name === 'keyword_search') {
    // Use displayData if available (for filtered results), otherwise fall back to raw data
    const data = displayData || latestResult.data as KeywordSearchResult

    const isCapped = data.showing_count && data.showing_count < data.total_count
    const isFiltered = filteredResults !== null

    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">
            projects found{isCapped && ` · showing top ${data.showing_count}`}
            {isFiltered && ' (filtered)'}
          </div>
          {data.search_query && (
            <div className="text-xs text-gray-400 mt-2">
              Keyword + semantic search for "{data.search_query}"
            </div>
          )}
        </div>

        {/* Filter Chips - always show original counts for multi-select */}
        {searchContext && (Object.keys(searchContext.originalResults.by_category || {}).length > 0 || Object.keys(searchContext.originalResults.by_org_type || {}).length > 0) && (
          <div className="p-6 border-b border-gray-100">
            <FilterChips
              byCategory={searchContext.originalResults.by_category || {}}
              byOrgType={searchContext.originalResults.by_org_type || {}}
              filteredByCategory={crossFilteredByCategory}
              filteredByOrgType={crossFilteredByOrgType}
              keywordQuery={searchContext.keywordQuery}
              semanticQuery={searchContext.semanticQuery}
              onFilterChange={onFilterChange}
              isLoading={false}
            />
          </div>
        )}

        {data.all_results?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-4">Most Relevant</h3>
            <div className="space-y-5">
              {data.all_results.slice(0, 100).map((project) => (
                <div key={project.application_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <button
                      onClick={() => onProjectClick?.(project.application_id)}
                      className="text-sm text-gray-900 leading-snug flex-1 hover:text-[#E07A5F] transition-colors text-left"
                    >
                      {project.title}
                    </button>
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
                          className={`w-2 h-2 rounded-full ${color}`}
                          title={label}
                        />
                      )
                    })()}
                    <span>{project.org_name}</span>
                    {project.org_state && <span>• {project.org_state}</span>}
                    {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                  </div>
                  {(project.pi_names || project.program_officer) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {project.pi_names && <>PI: {project.pi_names.split(';')[0]?.trim()}</>}
                      {project.pi_names && project.program_officer && <span className="mx-1">•</span>}
                      {project.program_officer && <>PO: {project.program_officer}</>}
                    </p>
                  )}
                  <button
                    onClick={() => onProjectClick?.(project.application_id)}
                    className="text-xs text-gray-400 mt-1 hover:text-[#E07A5F] transition-colors inline-block"
                  >
                    ID: {project.application_id}
                  </button>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    {(() => {
                      const { isSbir, isSttr } = getSbirSttrStatus(project.activity_code)
                      return (
                        <>
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
                        </>
                      )
                    })()}
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
                </div>
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
      <div className="h-full overflow-y-auto">
        <div className="p-6 border-b border-gray-100">
          <div className="text-4xl font-semibold tracking-tight text-gray-900">{data.total_count.toLocaleString()}</div>
          <div className="text-sm text-gray-400 mt-1">
            projects found{isCapped && ` · showing top ${data.showing_count}`}
            {isFiltered && ' (filtered)'}
          </div>
          {data.search_query && (
            <div className="text-xs text-gray-400 mt-2">
              Keyword + semantic search for "{data.search_query}"
            </div>
          )}
        </div>

        {/* Filter Chips - always show original counts for multi-select */}
        {searchContext && (Object.keys(searchContext.originalResults.by_category || {}).length > 0 || Object.keys(searchContext.originalResults.by_org_type || {}).length > 0) && (
          <div className="p-6 border-b border-gray-100">
            <FilterChips
              byCategory={searchContext.originalResults.by_category || {}}
              byOrgType={searchContext.originalResults.by_org_type || {}}
              filteredByCategory={crossFilteredByCategory}
              filteredByOrgType={crossFilteredByOrgType}
              keywordQuery={searchContext.keywordQuery}
              semanticQuery={searchContext.semanticQuery}
              onFilterChange={onFilterChange}
              isLoading={false}
            />
          </div>
        )}

        {data.all_results?.length > 0 && (
          <div className="p-6">
            <h3 className="text-xs font-semibold text-[#E07A5F] uppercase tracking-wider mb-4">Most Relevant</h3>
            <div className="space-y-5">
              {data.all_results.slice(0, 100).map((project) => (
                <div key={project.application_id} className="pb-4 border-b border-gray-50 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <button
                      onClick={() => onProjectClick?.(project.application_id)}
                      className="text-sm text-gray-900 leading-snug flex-1 hover:text-[#E07A5F] transition-colors text-left"
                    >
                      {project.title}
                    </button>
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
                          className={`w-2 h-2 rounded-full ${color}`}
                          title={label}
                        />
                      )
                    })()}
                    <span>{project.org_name}</span>
                    {project.org_state && <span>• {project.org_state}</span>}
                    {project.fiscal_year && <span>• FY{project.fiscal_year}</span>}
                  </div>
                  {(project.pi_names || project.program_officer) && (
                    <p className="text-xs text-gray-500 mt-1">
                      {project.pi_names && <>PI: {project.pi_names.split(';')[0]?.trim()}</>}
                      {project.pi_names && project.program_officer && <span className="mx-1">•</span>}
                      {project.program_officer && <>PO: {project.program_officer}</>}
                    </p>
                  )}
                  <button
                    onClick={() => onProjectClick?.(project.application_id)}
                    className="text-xs text-gray-400 mt-1 hover:text-[#E07A5F] transition-colors inline-block"
                  >
                    ID: {project.application_id}
                  </button>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    {(() => {
                      const { isSbir, isSttr } = getSbirSttrStatus(project.activity_code)
                      return (
                        <>
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
                        </>
                      )
                    })()}
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
                </div>
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

export function Chat({ persona }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [toolResults, setToolResults] = useState<ToolResult[]>([])
  const [searchContext, setSearchContext] = useState<SearchContext | null>(null)
  const [filteredResults, setFilteredResults] = useState<KeywordSearchResult | null>(null)
  const [currentFilters, setCurrentFilters] = useState<{ primary_category?: string[]; org_type?: string[] }>({})
  const [specificity, setSpecificity] = useState<'focused' | 'balanced' | 'broad'>('balanced')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const router = useRouter()
  const metadata = PERSONA_METADATA[persona]
  const IconComponent = ICONS[metadata.icon]

  // Restore search state from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('searchState')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.toolResults) setToolResults(state.toolResults)
        if (state.searchContext) setSearchContext(state.searchContext)
        if (state.filteredResults) setFilteredResults(state.filteredResults)
        if (state.currentFilters) setCurrentFilters(state.currentFilters)
        if (state.messages) setMessages(state.messages)
        // Clear after restoring so refresh doesn't restore again
        sessionStorage.removeItem('searchState')
      } catch (e) {
        console.error('Failed to restore search state:', e)
      }
    }
  }, [])

  // Save search state and navigate to project
  const navigateToProject = useCallback((applicationId: string) => {
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

  // Handle filter changes - filter client-side from stored results
  const handleFilterChange = useCallback((filters: { primary_category?: string[]; org_type?: string[] }) => {
    setCurrentFilters(filters)

    if (!searchContext) return

    const allResults = searchContext.originalResults.all_results

    // If no filters, clear filtered results and show original
    if (!filters.primary_category?.length && !filters.org_type?.length) {
      setFilteredResults(null)
      return
    }

    // Filter the full result set client-side
    let filtered = allResults

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
        body: JSON.stringify({ messages: updatedMessages.map(m => ({ role: m.role, content: m.content })), persona, specificity })
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

  const handleNewSearch = () => {
    setMessages([])
    setToolResults([])
    setSearchContext(null)
    setFilteredResults(null)
    setCurrentFilters({})
    setInput('')
    inputRef.current?.focus()
  }

  const isLastAssistantMessage = (messageId: string) => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    return lastAssistant?.id === messageId
  }

  // Compute cross-filtered counts for dynamic chip numbers
  // - crossFilteredByCategory: counts when only org_type filter is applied (for category chips)
  // - crossFilteredByOrgType: counts when only category filter is applied (for org_type chips)
  const { crossFilteredByCategory, crossFilteredByOrgType } = useMemo(() => {
    if (!searchContext) return { crossFilteredByCategory: undefined, crossFilteredByOrgType: undefined }

    const allResults = searchContext.originalResults.all_results
    const hasCategory = currentFilters.primary_category?.length
    const hasOrgType = currentFilters.org_type?.length

    // If no filters, return undefined (chips will use original counts)
    if (!hasCategory && !hasOrgType) {
      return { crossFilteredByCategory: undefined, crossFilteredByOrgType: undefined }
    }

    // For category chips: filter by org_type only, then count categories
    let categoryFiltered = allResults
    if (hasOrgType) {
      categoryFiltered = allResults.filter(p =>
        p.org_type && currentFilters.org_type!.includes(p.org_type)
      )
    }
    const byCategory: Record<string, number> = {}
    categoryFiltered.forEach(p => {
      const cat = p.primary_category || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
    })

    // For org_type chips: filter by category only, then count org_types
    let orgFiltered = allResults
    if (hasCategory) {
      orgFiltered = allResults.filter(p =>
        p.primary_category && currentFilters.primary_category!.includes(p.primary_category)
      )
    }
    const byOrgType: Record<string, number> = {}
    orgFiltered.forEach(p => {
      const org = p.org_type || 'other'
      byOrgType[org] = (byOrgType[org] || 0) + 1
    })

    return {
      crossFilteredByCategory: hasOrgType ? byCategory : undefined,
      crossFilteredByOrgType: hasCategory ? byOrgType : undefined
    }
  }, [searchContext, currentFilters])

  return (
    <div className="h-full bg-white flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="flex flex-col w-full lg:w-[480px] xl:w-[520px] lg:border-r lg:border-gray-100 min-h-0">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-8 min-h-0">
          <div className="space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="flex justify-center mb-6">
                  <IconComponent className="w-12 h-12 text-gray-300" strokeWidth={1.5} />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900 mb-2">
                  {metadata.title}
                </h2>
                <p className="text-sm text-[#E07A5F] mb-2">
                  &ldquo;{metadata.subtitle}&rdquo;
                </p>
                <p className="text-gray-400 mb-8 max-w-sm mx-auto text-sm">
                  {metadata.description}
                </p>
                {metadata.exampleQueries.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400">Try an example</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {metadata.exampleQueries.slice(0, 3).map((query, index) => (
                        <button
                          key={index}
                          onClick={() => handleExampleClick(query)}
                          className="px-4 py-2 text-sm bg-white border border-gray-100 rounded-full hover:border-[#E07A5F] hover:shadow-md text-gray-600 transition-all"
                        >
                          {query}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {messages.map(message => {
              const showChoices = message.role === 'assistant' && !message.isStreaming && !isLoading && isLastAssistantMessage(message.id)
              const { text, choices } = showChoices ? parseMessageWithChoices(message.content) : { text: message.content, choices: [] }

              return (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${message.role === 'user' ? 'text-right' : ''}`}>
                    {message.role === 'user' ? (
                      <div className="inline-block px-4 py-2.5 bg-gray-100 rounded-2xl rounded-br-md">
                        <p className="text-sm text-gray-900">{message.content}</p>
                      </div>
                    ) : (
                      <div>
                        {message.isToolCall && (
                          <div className="flex items-center space-x-2 text-sm text-gray-400 mb-3">
                            <div className="w-4 h-4 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
                            <span>Searching...</span>
                          </div>
                        )}
                        <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                          {showChoices ? text : message.content}
                          {message.isStreaming && !message.content && (
                            <span className="inline-block w-1.5 h-4 bg-gray-300 animate-pulse ml-0.5" />
                          )}
                        </div>
                        {showChoices && choices.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {choices.map((choice, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleChoiceClick(choice)}
                                className="px-3 py-1.5 text-xs bg-white border border-gray-100 rounded-full hover:border-[#E07A5F] hover:shadow-sm text-gray-600 transition-all"
                              >
                                {choice}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100">
          {/* New search link - appears when there are messages or results */}
          {(messages.length > 0 || toolResults.length > 0) && (
            <div className="mb-3">
              <button
                onClick={handleNewSearch}
                className="text-xs text-gray-400 hover:text-[#E07A5F] transition-colors"
              >
                New search
              </button>
            </div>
          )}
          {/* Specificity chips */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-gray-400">Search scope:</span>
            {(['focused', 'balanced', 'broad'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setSpecificity(level)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  specificity === level
                    ? 'bg-[#E07A5F] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit}>
            <div className="flex items-end space-x-3">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value.slice(0, 140))}
                  onKeyDown={handleKeyDown}
                  placeholder={metadata.placeholder || "Ask a question..."}
                  rows={1}
                  maxLength={140}
                  className="w-full px-4 py-3 bg-gray-50 border-0 rounded-xl resize-none text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-sm"
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
                className="p-3 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-40 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </div>

        {/* Right Panel - Results */}
        <div className="hidden lg:flex flex-col flex-1">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">Results</h2>
            <p className="text-xs text-gray-400 mt-0.5">NIH RePORTER & USPTO PatentsView</p>
          </div>
          <div className="flex-1 overflow-hidden">
            <ResultsPanel
              results={toolResults}
              searchContext={searchContext}
              filteredResults={filteredResults}
              onFilterChange={handleFilterChange}
              crossFilteredByCategory={crossFilteredByCategory}
              crossFilteredByOrgType={crossFilteredByOrgType}
              onProjectClick={navigateToProject}
            />
          </div>
        </div>
    </div>
  )
}
