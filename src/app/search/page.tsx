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
  { id: 'proteomics', label: 'Proteomics', icon: '🧬' },
  { id: 'genomics', label: 'Genomics', icon: '🔬' },
  { id: 'imaging', label: 'Imaging', icon: '📷' },
  { id: 'drug-dev', label: 'Drug Development', icon: '💉' },
  { id: 'bioinformatics', label: 'Bioinformatics', icon: '💻' },
  { id: 'sequencing', label: 'Sequencing', icon: '🧪' },
  { id: 'gene-editing', label: 'Gene Editing', icon: '✂️' },
  { id: 'immunology', label: 'Immunology', icon: '🛡️' },
]

// Organization Types
const orgTypes = [
  { id: 'company', label: 'Company', icon: '🏢' },
  { id: 'university', label: 'University', icon: '🎓' },
  { id: 'hospital', label: 'Hospital', icon: '🏥' },
  { id: 'research_institute', label: 'Research Institute', icon: '🔬' },
]

// Fiscal Years (last 10 years)
const currentYear = new Date().getFullYear()
const fiscalYears = Array.from({ length: 10 }, (_, i) => currentYear - i)

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

  // Filters
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedFocus, setSelectedFocus] = useState('')
  const [selectedOrgType, setSelectedOrgType] = useState('')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [sbirOnly, setSbirOnly] = useState(false)
  const [supplementFilter, setSupplementFilter] = useState<'all' | 'base' | 'supplements'>('all')

  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'list'>('cards')

  const performSearch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (selectedCategory) params.set('category', selectedCategory)
      if (selectedFocus) params.set('focus', selectedFocus)
      if (selectedOrgType) params.set('orgType', selectedOrgType)
      if (selectedYear) params.set('year', selectedYear.toString())
      if (sbirOnly) params.set('fundingMechanism', 'SBIR')
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
  }, [query, selectedCategory, selectedFocus, selectedOrgType, selectedYear, sbirOnly, supplementFilter])

  useEffect(() => {
    if (query || selectedCategory || selectedFocus || selectedOrgType || selectedYear) {
      performSearch()
    }
  }, [performSearch, query, selectedCategory, selectedFocus, selectedOrgType, selectedYear, supplementFilter])

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    performSearch()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold">
              <span className="bg-gradient-to-r from-teal-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
                granted.bio
              </span>
            </Link>
            <div className="flex items-center gap-6">
              <div className="text-sm text-gray-400">
                <span className="text-teal-400 font-semibold">{total > 0 ? total.toLocaleString() : '72K+'}</span> grants
              </div>
              <Link href="/admin" className="text-gray-300 hover:text-teal-400 text-sm font-medium transition-colors">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Search Hero */}
        <div className="mb-12">
          <h1 className="text-5xl md:text-6xl font-extrabold text-white mb-4 text-center leading-tight">
            Discover Life Sciences
            <br />
            <span className="bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
              Innovation
            </span>
          </h1>
          <p className="text-gray-400 text-center mb-10 text-lg max-w-3xl mx-auto">
            Search 72,000+ NIH grants using natural language. Find companies, technologies, and research breakthroughs.
          </p>

          {/* Main Search Bar */}
          <form onSubmit={handleSearch} className="max-w-5xl mx-auto mb-10">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-300"></div>
              <div className="relative flex items-center bg-gray-800 rounded-3xl shadow-2xl overflow-hidden border border-gray-700">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., CRISPR tools for cancer therapy, mass spec proteomics platforms..."
                  className="flex-1 px-8 py-6 bg-transparent text-white placeholder-gray-500 focus:outline-none text-lg"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="mx-2 px-10 py-4 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-2xl font-bold hover:from-teal-600 hover:to-cyan-600 transition-all disabled:opacity-50 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200"
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

          {/* Filters Section */}
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Life Science Category Filter */}
            <div>
              <div className="text-sm font-semibold text-gray-400 mb-3">Life Science Category</div>
              <div className="flex flex-wrap gap-2">
                {lifeScienceCategories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id === selectedCategory ? '' : cat.id)}
                    className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 text-sm ${
                      selectedCategory === cat.id
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-teal-500/30 scale-105'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 hover:border-teal-500/50'
                    }`}
                  >
                    <span className="mr-1.5">{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Research Focus Filter */}
            <div>
              <div className="text-sm font-semibold text-gray-400 mb-3">Research Focus</div>
              <div className="flex flex-wrap gap-2">
                {focusAreas.map((focus) => (
                  <button
                    key={focus.id}
                    onClick={() => setSelectedFocus(focus.id === selectedFocus ? '' : focus.id)}
                    className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 text-sm ${
                      selectedFocus === focus.id
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-teal-500/30 scale-105'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 hover:border-teal-500/50'
                    }`}
                  >
                    <span className="mr-1.5">{focus.icon}</span>
                    <span>{focus.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Organization Type Filter */}
            <div>
              <div className="text-sm font-semibold text-gray-400 mb-3">Organization Type</div>
              <div className="flex flex-wrap gap-2">
                {orgTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedOrgType(type.id === selectedOrgType ? '' : type.id)}
                    className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 text-sm ${
                      selectedOrgType === type.id
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-teal-500/30 scale-105'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 hover:border-teal-500/50'
                    }`}
                  >
                    <span className="mr-1.5">{type.icon}</span>
                    <span>{type.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Year Filter */}
            <div>
              <div className="text-sm font-semibold text-gray-400 mb-3">Fiscal Year</div>
              <div className="flex flex-wrap gap-2">
                {fiscalYears.map((year) => (
                  <button
                    key={year}
                    onClick={() => setSelectedYear(year === selectedYear ? null : year)}
                    className={`px-4 py-2 rounded-full font-medium transition-all transform hover:scale-105 text-sm ${
                      selectedYear === year
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg shadow-teal-500/30 scale-105'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 hover:border-teal-500/50'
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Filters & Controls Bar */}
        <div className="flex items-center justify-between mb-8 bg-gray-800/40 backdrop-blur-sm rounded-2xl p-5 border border-gray-700/50">
          <div className="flex items-center gap-8">
            {/* SBIR/STTR Toggle */}
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={sbirOnly}
                  onChange={(e) => setSbirOnly(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-14 h-7 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-teal-500 peer-checked:to-cyan-500 peer-checked:shadow-lg peer-checked:shadow-teal-500/30"></div>
              </div>
              <span className="text-gray-300 font-semibold group-hover:text-teal-400 transition-colors">
                SBIR/STTR Only
              </span>
            </label>

            {/* Supplement Filter */}
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm font-medium">Grants:</span>
              <div className="flex items-center gap-1 bg-gray-900/50 rounded-lg p-1 border border-gray-700">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'base', label: 'Base Only' },
                  { id: 'supplements', label: 'Supplements' }
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setSupplementFilter(option.id as 'all' | 'base' | 'supplements')}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                      supplementFilter === option.id
                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Results Count */}
            {total > 0 && (
              <div className="text-gray-400 font-medium">
                <span className="text-2xl font-bold text-teal-400">{total.toLocaleString()}</span>
                <span className="ml-2">results</span>
              </div>
            )}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-gray-900/50 rounded-xl p-1 border border-gray-700">
            {(['cards', 'table', 'list'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  viewMode === mode
                    ? 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white shadow-lg'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="relative">
              <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-teal-500"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-12 w-12 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 opacity-20"></div>
              </div>
            </div>
            <p className="mt-6 text-gray-400 font-medium">Searching...</p>
          </div>
        ) : results.length > 0 ? (
          <div className={viewMode === 'cards' ? 'grid md:grid-cols-2 gap-6' : 'space-y-5'}>
            {results.map((project) => (
              <Link
                key={project.application_id}
                href={`/company/${project.project_number}`}
                className="block group"
              >
                <div className="bg-gray-800/40 backdrop-blur-sm border border-gray-700 rounded-2xl p-7 hover:border-teal-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-teal-500/10 transform hover:-translate-y-1">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-xl font-bold text-white group-hover:text-teal-400 transition-colors line-clamp-2 flex-1 pr-4 leading-tight">
                      {project.title}
                    </h3>
                    {project.biotools_confidence !== null && (
                      <span className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${
                        project.biotools_confidence >= 60
                          ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                          : project.biotools_confidence >= 35
                          ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
                          : 'bg-gray-500/20 text-gray-400 ring-1 ring-gray-500/30'
                      }`}>
                        {Math.round(project.biotools_confidence)}%
                      </span>
                    )}
                  </div>

                  <div className="text-teal-400 font-bold text-sm mb-3 group-hover:text-cyan-400 transition-colors">
                    {project.org_name}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-400 mb-4">
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {project.org_city}, {project.org_state}
                    </span>
                    <span className="text-gray-600">•</span>
                    <span>FY{project.fiscal_year}</span>
                    {project.funding_mechanism?.includes('SBIR') && (
                      <>
                        <span className="text-gray-600">•</span>
                        <span className="px-2.5 py-1 bg-teal-500/20 text-teal-400 rounded-full font-bold text-xs">
                          SBIR/STTR
                        </span>
                      </>
                    )}
                  </div>

                  <p className="text-gray-400 text-sm line-clamp-3 leading-relaxed mb-4">
                    {project.phr || 'No description available'}
                  </p>

                  {project.total_cost && (
                    <div className="flex items-center gap-2 text-gray-500 text-sm font-semibold">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Award: ${project.total_cost.toLocaleString()}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (query || selectedCategory || selectedFocus || selectedOrgType || selectedYear) ? (
          <div className="text-center py-32">
            <div className="text-8xl mb-6 opacity-20">🔍</div>
            <p className="text-gray-400 text-xl font-medium mb-2">No results found</p>
            <p className="text-gray-500">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="text-center py-32">
            <div className="text-8xl mb-6">🧬</div>
            <p className="text-gray-300 text-2xl font-bold mb-3">Ready to explore?</p>
            <p className="text-gray-500 text-lg">Enter a search query or select filters above</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-teal-500"></div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}
