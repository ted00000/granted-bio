'use client'

import { Suspense, useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

// Life Science Categories
const lifeScienceCategories = [
  { id: 'biotools', label: 'Biotools', icon: '🔧' },
  { id: 'therapeutics', label: 'Therapeutics', icon: '💊' },
  { id: 'diagnostics', label: 'Diagnostics', icon: '🩺' },
  { id: 'medical_device', label: 'Medical Device', icon: '⚕️' },
  { id: 'digital_health', label: 'Digital Health', icon: '📱' },
]

// Research Focus Areas
const focusAreas = [
  { id: 'proteomics', label: 'Proteomics' },
  { id: 'genomics', label: 'Genomics' },
  { id: 'imaging', label: 'Imaging' },
  { id: 'drug-dev', label: 'Drug Development' },
  { id: 'bioinformatics', label: 'Bioinformatics' },
  { id: 'sequencing', label: 'Sequencing' },
]

// Organization Types
const orgTypes = [
  { id: 'company', label: 'Company', icon: '🏢' },
  { id: 'university', label: 'University', icon: '🎓' },
  { id: 'hospital', label: 'Hospital', icon: '🏥' },
  { id: 'research_institute', label: 'Research Institute', icon: '🔬' },
]

// Fiscal Years (limited to recent years)
const fiscalYears = [2026, 2025, 2024, 2023]

interface SearchResult {
  id: string
  application_id: string
  project_number: string
  title: string
  phr: string | null
  org_name: string | null
  org_type: string | null
  org_city: string | null
  org_state: string | null
  total_cost: number | null
  fiscal_year: number | null
  funding_mechanism: string | null
  primary_category: string | null
  biotools_confidence: number | null
  is_supplement: boolean | null
  supplement_number: string | null
}

function SearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')

  // Multi-select Filters
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedOrgTypes, setSelectedOrgTypes] = useState<string[]>([])
  const [selectedYears, setSelectedYears] = useState<number[]>([])
  const [selectedFundingMechanisms, setSelectedFundingMechanisms] = useState<string[]>([])
  const [supplementFilter, setSupplementFilter] = useState<'all' | 'base' | 'supplements'>('all')

  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // Toggle functions for multi-select
  const toggleCategory = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  const toggleOrgType = (orgTypeId: string) => {
    setSelectedOrgTypes(prev =>
      prev.includes(orgTypeId)
        ? prev.filter(id => id !== orgTypeId)
        : [...prev, orgTypeId]
    )
  }

  const toggleYear = (year: number) => {
    setSelectedYears(prev =>
      prev.includes(year)
        ? prev.filter(y => y !== year)
        : [...prev, year]
    )
  }

  const toggleFundingMechanism = (mechanism: string) => {
    setSelectedFundingMechanisms(prev =>
      prev.includes(mechanism)
        ? prev.filter(m => m !== mechanism)
        : [...prev, mechanism]
    )
  }

  const performSearch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)

      // Multi-select filters - send as comma-separated values
      if (selectedCategories.length > 0) {
        params.set('categories', selectedCategories.join(','))
      }
      if (selectedOrgTypes.length > 0) {
        params.set('orgTypes', selectedOrgTypes.join(','))
      }
      if (selectedYears.length > 0) {
        params.set('years', selectedYears.join(','))
      }
      if (selectedFundingMechanisms.length > 0) {
        params.set('fundingMechanisms', selectedFundingMechanisms.join(','))
      }
      if (supplementFilter !== 'all') params.set('supplements', supplementFilter)
      params.set('limit', '50')

      const response = await fetch(`/api/search?${params.toString()}`)
      const data = await response.json()
      setResults(data.results || [])
      setTotal(data.total || 0)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, selectedCategories, selectedOrgTypes, selectedYears, selectedFundingMechanisms, supplementFilter])

  useEffect(() => {
    if (query || selectedCategories.length > 0 || selectedOrgTypes.length > 0 || selectedYears.length > 0 || selectedFundingMechanisms.length > 0) {
      performSearch()
    }
  }, [performSearch, query, selectedCategories, selectedOrgTypes, selectedYears, selectedFundingMechanisms, supplementFilter])

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    performSearch()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-xl sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold">
              <span className="text-gray-900">granted</span>
              <span className="text-teal-500">.bio</span>
            </Link>
            <div className="flex items-center gap-6">
              <div className="text-sm text-gray-600">
                <span className="text-teal-600 font-bold">{total > 0 ? total.toLocaleString() : '60K+'}</span> grants
              </div>
              <Link href="/admin" className="text-gray-600 hover:text-teal-600 text-sm font-medium transition-colors">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Search Hero */}
        <div className="mb-8">
          <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 mb-4 text-center leading-tight">
            Life Sciences Grant Intelligence
          </h1>
          <p className="text-gray-600 text-center mb-10 text-lg max-w-3xl mx-auto">
            Search 60,000+ NIH grants using natural language. Discover companies, technologies, and research breakthroughs.
          </p>

          {/* Main Search Bar */}
          <form onSubmit={handleSearch} className="max-w-4xl mx-auto mb-12">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-300"></div>
              <div className="relative flex items-center bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-gray-200 group-hover:border-teal-400 transition-all">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., CRISPR tools for cancer therapy, mass spec proteomics platforms..."
                  className="flex-1 px-8 py-5 bg-transparent text-gray-900 placeholder-gray-400 focus:outline-none text-lg"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="mx-2 px-8 py-3.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-bold hover:from-teal-600 hover:to-cyan-600 transition-all disabled:opacity-50 shadow-lg"
                >
                  {loading ? (
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                  ) : (
                    'Search'
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Equalizer Filter Panel */}
          <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 bg-teal-500 rounded-full"></div>
                <div className="w-1 h-4 bg-teal-400 rounded-full"></div>
                <div className="w-1 h-5 bg-teal-300 rounded-full"></div>
              </div>
              <h2 className="text-lg font-bold text-gray-900">Refine Search</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Life Science Channel */}
              <div className="border-l-4 border-cyan-500 pl-4">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Life Science Area</div>
                <div className="space-y-2">
                  {lifeScienceCategories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => toggleCategory(cat.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                        selectedCategories.includes(cat.id)
                          ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <span className="mr-2">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Organization Channel */}
              <div className="border-l-4 border-teal-400 pl-4">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Organization Type</div>
                <div className="space-y-2">
                  {orgTypes.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => toggleOrgType(type.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                        selectedOrgTypes.includes(type.id)
                          ? 'bg-gradient-to-r from-teal-400 to-cyan-400 text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <span className="mr-2">{type.icon}</span>
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grant Type Channel (with SBIR/STTR) */}
              <div className="border-l-4 border-teal-500 pl-4">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Grant Type</div>
                <div className="space-y-2">
                  {[
                    { id: 'all', label: 'All Grants', desc: '60K+' },
                    { id: 'base', label: 'Base Only', desc: '57K' },
                    { id: 'supplements', label: 'Supplements', desc: '3K' }
                  ].map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setSupplementFilter(option.id as 'all' | 'base' | 'supplements')}
                      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-all ${
                        supplementFilter === option.id
                          ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-teal-500/30'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{option.label}</span>
                        <span className={`text-xs ${supplementFilter === option.id ? 'text-white/70' : 'text-gray-400'}`}>
                          {option.desc}
                        </span>
                      </div>
                    </button>
                  ))}
                  <div className="pt-2 border-t border-gray-200 mt-2">
                    <button
                      onClick={() => toggleFundingMechanism('SBIR')}
                      className={`w-full text-left px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                        selectedFundingMechanisms.includes('SBIR')
                          ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      SBIR/STTR ONLY
                    </button>
                  </div>
                </div>
              </div>

              {/* Year Channel */}
              <div className="border-l-4 border-cyan-400 pl-4">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Fiscal Year</div>
                <div className="grid grid-cols-2 gap-2">
                  {fiscalYears.map((year) => (
                    <button
                      key={year}
                      onClick={() => toggleYear(year)}
                      className={`px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                        selectedYears.includes(year)
                          ? 'bg-gradient-to-r from-cyan-400 to-teal-400 text-white shadow-md'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200'
                      }`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results Bar */}
        {total > 0 && (
          <div className="flex items-center justify-between mb-6 px-4">
            <div className="text-gray-600">
              <span className="text-3xl font-bold text-teal-600">{total.toLocaleString()}</span>
              <span className="ml-2 text-lg">results found</span>
            </div>
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="relative">
              <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-teal-500"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 opacity-20"></div>
              </div>
            </div>
            <p className="mt-6 text-gray-600 font-medium">Searching...</p>
          </div>
        ) : results.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-6">
            {results.map((project) => (
              <Link
                key={project.application_id}
                href={`/company/${project.project_number}`}
                className="block group"
              >
                <div className="bg-white border-2 border-gray-200 rounded-xl p-6 hover:border-teal-400 transition-all duration-300 hover:shadow-xl transform hover:-translate-y-1">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-xl font-bold text-gray-900 group-hover:text-teal-600 transition-colors line-clamp-2 flex-1 pr-4">
                      {project.title}
                    </h3>
                    {project.biotools_confidence !== null && (
                      <span className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                        project.biotools_confidence >= 60
                          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300'
                          : project.biotools_confidence >= 35
                          ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                          : 'bg-gray-100 text-gray-600 ring-1 ring-gray-300'
                      }`}>
                        {Math.round(project.biotools_confidence)}%
                      </span>
                    )}
                  </div>

                  <div className="text-teal-600 font-bold text-sm mb-3">
                    {project.org_name}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500 mb-4">
                    <span>{project.org_city}, {project.org_state}</span>
                    <span>•</span>
                    <span>FY{project.fiscal_year}</span>
                    {project.is_supplement && (
                      <>
                        <span>•</span>
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-semibold text-xs">
                          Supplement {project.supplement_number}
                        </span>
                      </>
                    )}
                    {project.funding_mechanism?.includes('SBIR') && (
                      <>
                        <span>•</span>
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full font-semibold text-xs">
                          SBIR
                        </span>
                      </>
                    )}
                  </div>

                  <p className="text-gray-600 text-sm line-clamp-3 leading-relaxed">
                    {project.phr || 'No description available'}
                  </p>

                  {project.total_cost && (
                    <div className="mt-4 pt-4 border-t border-gray-100 text-gray-500 text-sm font-semibold">
                      ${project.total_cost.toLocaleString()}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-gray-400 text-lg mb-2">No results found</div>
            <p className="text-gray-500 text-sm">Try adjusting your search or filters</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
