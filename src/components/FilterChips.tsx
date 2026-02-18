'use client'

import { useState, useEffect } from 'react'

interface FilterChipsProps {
  byCategory: Record<string, number>
  byOrgType: Record<string, number>
  // Filtered counts (dynamic based on cross-dimension selection)
  filteredByCategory?: Record<string, number>
  filteredByOrgType?: Record<string, number>
  keywordQuery: string
  semanticQuery: string
  onFilterChange: (filters: { primary_category?: string[]; org_type?: string[] }) => void
  isLoading?: boolean
}

// Display names for categories
const CATEGORY_LABELS: Record<string, string> = {
  biotools: 'Research Tools',
  therapeutics: 'Therapeutics',
  diagnostics: 'Diagnostics',
  medical_device: 'Medical Devices',
  digital_health: 'Digital Health',
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

export function FilterChips({
  byCategory,
  byOrgType,
  filteredByCategory,
  filteredByOrgType,
  keywordQuery,
  semanticQuery,
  onFilterChange,
  isLoading = false
}: FilterChipsProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedOrgTypes, setSelectedOrgTypes] = useState<string[]>([])

  // Reset filters when search query changes
  useEffect(() => {
    setSelectedCategories([])
    setSelectedOrgTypes([])
  }, [keywordQuery, semanticQuery])

  // Notify parent of filter changes
  useEffect(() => {
    const filters: { primary_category?: string[]; org_type?: string[] } = {}
    if (selectedCategories.length > 0) filters.primary_category = selectedCategories
    if (selectedOrgTypes.length > 0) filters.org_type = selectedOrgTypes
    onFilterChange(filters)
  }, [selectedCategories, selectedOrgTypes, onFilterChange])

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

  const clearFilters = () => {
    setSelectedCategories([])
    setSelectedOrgTypes([])
  }

  const hasFilters = selectedCategories.length > 0 || selectedOrgTypes.length > 0

  // Use original counts for chip list (so all options stay visible)
  // Use filtered counts for display numbers (dynamic based on cross-selection)
  const displayCategoryCounts = filteredByCategory || byCategory
  const displayOrgTypeCounts = filteredByOrgType || byOrgType

  // Sort by original counts to maintain stable order
  const sortedCategories = Object.entries(byCategory).sort(([, a], [, b]) => b - a)
  const sortedOrgTypes = Object.entries(byOrgType).sort(([, a], [, b]) => b - a)

  if (sortedCategories.length === 0 && sortedOrgTypes.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      {/* Header with clear button */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Filter Results
        </h3>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-[#E07A5F] hover:text-[#C96A4F] transition-colors"
            disabled={isLoading}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Category filters */}
      {sortedCategories.length > 0 && (
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Life Science Area</h4>
          <div className="flex flex-wrap gap-2">
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
                  className={`
                    px-3 py-1.5 text-xs rounded-full border transition-all
                    ${isSelected
                      ? 'bg-[#E07A5F] text-white border-[#E07A5F]'
                      : displayCount === 0
                        ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-[#E07A5F]'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <span className="capitalize">{label}</span>
                  <span className={`ml-1.5 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                    {displayCount.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Org type filters */}
      {sortedOrgTypes.length > 0 && (
        <div>
          <h4 className="text-xs text-gray-500 mb-2">Organization Type</h4>
          <div className="flex flex-wrap gap-2">
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
                  className={`
                    px-3 py-1.5 text-xs rounded-full border transition-all
                    ${isSelected
                      ? 'bg-gray-800 text-white border-gray-800'
                      : displayCount === 0
                        ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <span className="capitalize">{label}</span>
                  <span className={`ml-1.5 ${isSelected ? 'text-white/80' : 'text-gray-400'}`}>
                    {displayCount.toLocaleString()}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="w-3 h-3 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          <span>Filtering...</span>
        </div>
      )}
    </div>
  )
}
