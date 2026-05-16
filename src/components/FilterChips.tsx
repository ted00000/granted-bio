'use client'

import { useState, useEffect } from 'react'

interface QuickFilters {
  activeOnly?: boolean
  sbirSttrOnly?: boolean
  hasPatents?: boolean
  hasClinicalTrials?: boolean
  hasPublications?: boolean
  precision?: 'low' | 'med' | 'high'
}

interface FilterChipsProps {
  byCategory: Record<string, number>
  byOrgType: Record<string, number>
  byState?: Record<string, number>
  // Filtered counts (dynamic based on cross-dimension selection)
  filteredByCategory?: Record<string, number>
  filteredByOrgType?: Record<string, number>
  filteredByState?: Record<string, number>
  // Currently-selected state (single-select, 2-letter code)
  currentState?: string
  // Quick filter counts
  quickFilterCounts?: {
    active: number
    sbirSttr: number
    patents: number
    clinicalTrials: number
    publications: number
    precisionLow: number
    precisionMed: number
    precisionHigh: number
  }
  keywordQuery: string
  semanticQuery: string
  onFilterChange: (filters: { primary_category?: string[]; org_type?: string[]; state?: string; quick?: QuickFilters }) => void
  isLoading?: boolean
  hideHeader?: boolean
}

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

// Display names for org types
const ORG_TYPE_LABELS: Record<string, string> = {
  company: 'Company',
  university: 'University',
  hospital: 'Hospital',
  research_institute: 'Research Institute',
  other: 'Other'
}

// US state codes → full names, used in the State filter dropdown
const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
}

export function FilterChips({
  byCategory,
  byOrgType,
  byState,
  filteredByCategory,
  filteredByOrgType,
  filteredByState,
  currentState,
  quickFilterCounts,
  keywordQuery,
  semanticQuery,
  onFilterChange,
  isLoading = false,
  hideHeader = false
}: FilterChipsProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedOrgTypes, setSelectedOrgTypes] = useState<string[]>([])
  const [selectedState, setSelectedState] = useState<string>('')
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({})
  const [isExpanded, setIsExpanded] = useState(true)

  // Sync external state value (e.g. from URL params) into local state
  useEffect(() => {
    setSelectedState(currentState ?? '')
  }, [currentState])

  // Reset filters when search query changes
  useEffect(() => {
    setSelectedCategories([])
    setSelectedOrgTypes([])
    setSelectedState('')
    setQuickFilters({})
  }, [keywordQuery, semanticQuery])

  // Notify parent of filter changes
  useEffect(() => {
    const filters: { primary_category?: string[]; org_type?: string[]; state?: string; quick?: QuickFilters } = {}
    if (selectedCategories.length > 0) filters.primary_category = selectedCategories
    if (selectedOrgTypes.length > 0) filters.org_type = selectedOrgTypes
    if (selectedState) filters.state = selectedState
    if (Object.keys(quickFilters).some(k => quickFilters[k as keyof QuickFilters])) {
      filters.quick = quickFilters
    }
    onFilterChange(filters)
  }, [selectedCategories, selectedOrgTypes, selectedState, quickFilters, onFilterChange])

  const toggleCategory = (category: string) => {
    if (isLoading) return
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    )
  }

  const toggleOrgType = (orgType: string) => {
    if (isLoading) return
    setSelectedOrgTypes(prev =>
      prev.includes(orgType)
        ? prev.filter(o => o !== orgType)
        : [...prev, orgType]
    )
  }

  const toggleQuickFilter = (filter: keyof QuickFilters) => {
    if (isLoading) return
    setQuickFilters(prev => ({
      ...prev,
      [filter]: !prev[filter]
    }))
  }

  const setPrecision = (level: 'low' | 'med' | 'high' | undefined) => {
    if (isLoading) return
    setQuickFilters(prev => ({
      ...prev,
      precision: prev.precision === level ? undefined : level
    }))
  }

  const clearFilters = () => {
    setSelectedCategories([])
    setSelectedOrgTypes([])
    setSelectedState('')
    setQuickFilters({})
  }

  const hasFilters = selectedCategories.length > 0 || selectedOrgTypes.length > 0 || !!selectedState || Object.values(quickFilters).some(Boolean)

  // Use original counts for chip list (so all options stay visible)
  // Use filtered counts for display numbers (dynamic based on cross-selection)
  const displayCategoryCounts = filteredByCategory || byCategory
  const displayOrgTypeCounts = filteredByOrgType || byOrgType

  // Sort by original counts to maintain stable order
  const sortedCategories = Object.entries(byCategory).sort(([, a], [, b]) => b - a)
  const sortedOrgTypes = Object.entries(byOrgType).sort(([, a], [, b]) => b - a)

  // Always render if we have precision counts (semantic search results) or category/org type data
  const hasPrecisionData = quickFilterCounts && (quickFilterCounts.precisionLow > 0 || quickFilterCounts.precisionMed > 0 || quickFilterCounts.precisionHigh > 0)
  if (sortedCategories.length === 0 && sortedOrgTypes.length === 0 && !hasPrecisionData) {
    return null
  }

  // Count active filters for collapsed state display
  const activeFilterCount = selectedCategories.length + selectedOrgTypes.length +
    (selectedState ? 1 : 0) +
    Object.values(quickFilters).filter(Boolean).length

  // State dropdown — alphabetized by full state name, with live counts that
  // honor other active filters. When filteredByState is defined (any filter
  // active), use those counts exclusively — and drop states that have zero
  // projects in the filtered set so the dropdown only lists actionable
  // choices. When no filters are active, use base counts.
  // Always include the currently-selected state even if its filtered count
  // is zero, so the user can see/clear their selection.
  const displayStateCounts = filteredByState ?? byState ?? {}
  const stateOptions = (byState ? Object.keys(byState) : [])
    .map((code) => ({
      code,
      count: displayStateCounts[code] ?? 0,
      label: US_STATE_NAMES[code] || code,
    }))
    .filter((o) => o.count > 0 || o.code === selectedState)
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="space-y-3">
      {/* Header with show/hide toggle and clear button */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-controls="filter-panel"
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              {isExpanded ? 'Hide filters' : 'Show filters'}
              <span className="sr-only"> panel</span>
            </button>
            <span className="text-gray-300">·</span>
            <h3 className="text-sm font-medium text-gray-500">
              Filters
            </h3>
            {!isExpanded && activeFilterCount > 0 && (
              <span className="text-xs text-gray-500">
                ({activeFilterCount} active)
              </span>
            )}
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
              disabled={isLoading}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Quick filters - toggles in a subtle card */}
      {isExpanded && (
      <div id="filter-panel" className="bg-gray-50 rounded-lg p-3" role="group" aria-label="Quick filters">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: 'activeOnly' as const, label: 'Active', count: quickFilterCounts?.active },
            { key: 'sbirSttrOnly' as const, label: 'SBIR/STTR', count: quickFilterCounts?.sbirSttr },
            { key: 'hasPatents' as const, label: 'Has Patents', count: quickFilterCounts?.patents },
            { key: 'hasClinicalTrials' as const, label: 'Has Trials', count: quickFilterCounts?.clinicalTrials },
            { key: 'hasPublications' as const, label: 'Has Pubs', count: quickFilterCounts?.publications },
          ].map(({ key, label, count }) => {
            const isSelected = quickFilters[key]
            const isDisabled = isLoading || (!isSelected && count === 0)
            return (
              <button
                key={key}
                onClick={() => toggleQuickFilter(key)}
                disabled={isDisabled}
                aria-pressed={isSelected}
                className={`
                  px-2 py-1 text-xs rounded-md border transition-all
                  ${isSelected
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : count === 0
                      ? 'bg-white/50 text-gray-300 border-gray-100 cursor-not-allowed'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-emerald-400'
                  }
                  ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
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

      {/* Category filters */}
      {isExpanded && sortedCategories.length > 0 && (
        <div role="group" aria-labelledby="category-filter-label">
          <h4 id="category-filter-label" className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Life Science Area</h4>
          <div className="flex flex-wrap gap-1.5">
            {sortedCategories.map(([category]) => {
              const isSelected = selectedCategories.includes(category)
              const label = CATEGORY_LABELS[category] || category.replace(/_/g, ' ')
              const displayCount = displayCategoryCounts[category] || 0
              const isDisabled = isLoading || (!isSelected && displayCount === 0)
              return (
                <button
                  key={category}
                  onClick={() => toggleCategory(category)}
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  className={`
                    px-2 py-1 text-xs rounded-md border transition-all
                    ${isSelected
                      ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                      : displayCount === 0
                        ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-[#E07A5F]'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <span className="capitalize">{label}</span>
                  <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                    {displayCount.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Org type filters */}
      {isExpanded && sortedOrgTypes.length > 0 && (
        <div role="group" aria-labelledby="orgtype-filter-label">
          <h4 id="orgtype-filter-label" className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Organization Type</h4>
          <div className="flex flex-wrap gap-1.5">
            {sortedOrgTypes.map(([orgType]) => {
              const isSelected = selectedOrgTypes.includes(orgType)
              const label = ORG_TYPE_LABELS[orgType] || orgType.replace(/_/g, ' ')
              const displayCount = displayOrgTypeCounts[orgType] || 0
              const isDisabled = isLoading || (!isSelected && displayCount === 0)
              return (
                <button
                  key={orgType}
                  onClick={() => toggleOrgType(orgType)}
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  className={`
                    px-2 py-1 text-xs rounded-md border transition-all
                    ${isSelected
                      ? 'bg-gray-800 text-white border-gray-800'
                      : displayCount === 0
                        ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <span className="capitalize">{label}</span>
                  <span className={`ml-1 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                    {displayCount.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* State filter (single-select dropdown) */}
      {isExpanded && stateOptions.length > 0 && (
        <div>
          <label htmlFor="state-filter" className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
            State
          </label>
          <select
            id="state-filter"
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            disabled={isLoading}
            className="text-xs bg-white border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#E07A5F]/30 focus:border-[#E07A5F] disabled:opacity-50"
          >
            <option value="">All states</option>
            {stateOptions.map(({ code, count, label }) => (
              <option key={code} value={code}>
                {label} ({count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Loading indicator */}
      {isExpanded && isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400" role="status" aria-live="polite">
          <div className="w-3 h-3 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" aria-hidden="true" />
          <span>Filtering...</span>
        </div>
      )}
    </div>
  )
}
