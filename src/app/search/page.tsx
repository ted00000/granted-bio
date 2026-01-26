'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

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
  biotools_reasoning: string | null
}

interface SearchResponse {
  results: SearchResult[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function SearchContent() {
  const searchParams = useSearchParams()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)

  // Filters
  const [minConfidence, setMinConfidence] = useState<number>(35)
  const [category, setCategory] = useState<string>('')
  const [orgType, setOrgType] = useState<string>('')
  const [year, setYear] = useState<string>('')

  const performSearch = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (minConfidence > 0) params.set('minConfidence', minConfidence.toString())
      if (category) params.set('category', category)
      if (orgType) params.set('orgType', orgType)
      if (year) params.set('year', year)
      params.set('page', page.toString())
      params.set('limit', '20')

      const response = await fetch(`/api/search?${params.toString()}`)
      const data: SearchResponse = await response.json()

      setResults(data.results || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 0)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query, minConfidence, category, orgType, year, page])

  useEffect(() => {
    performSearch()
  }, [performSearch])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    performSearch()
  }

  const getConfidenceColor = (confidence: number | null) => {
    if (!confidence) return 'bg-gray-100 text-gray-600'
    if (confidence >= 60) return 'bg-green-100 text-green-800'
    if (confidence >= 35) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  const getConfidenceLabel = (confidence: number | null) => {
    if (!confidence) return 'Unknown'
    if (confidence >= 60) return 'High'
    if (confidence >= 35) return 'Moderate'
    return 'Low'
  }

  const formatCost = (cost: number | null) => {
    if (!cost) return 'N/A'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(cost)
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for biotools companies, technologies, or keywords..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Confidence
            </label>
            <select
              value={minConfidence}
              onChange={(e) => {
                setMinConfidence(parseInt(e.target.value))
                setPage(1)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            >
              <option value="0">All</option>
              <option value="35">Moderate+ (35+)</option>
              <option value="60">High (60+)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organization Type
            </label>
            <select
              value={orgType}
              onChange={(e) => {
                setOrgType(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            >
              <option value="">All Types</option>
              <option value="company">Company</option>
              <option value="university">University</option>
              <option value="hospital">Hospital</option>
              <option value="research_institute">Research Institute</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            >
              <option value="">All Categories</option>
              <option value="biotools">Biotools</option>
              <option value="diagnostics">Diagnostics</option>
              <option value="therapeutics">Therapeutics</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fiscal Year
            </label>
            <select
              value={year}
              onChange={(e) => {
                setYear(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
            >
              <option value="">All Years</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="mb-4 text-sm text-gray-600">
        {loading ? (
          'Searching...'
        ) : (
          <>
            Found <strong>{total.toLocaleString()}</strong> results
            {query && (
              <>
                {' '}
                for &quot;<strong>{query}</strong>&quot;
              </>
            )}
          </>
        )}
      </div>

      {/* Results */}
      <div className="space-y-4">
        {results.map((result) => (
          <Link
            key={result.id}
            href={`/company/${result.project_number}`}
            className="block bg-white rounded-lg shadow hover:shadow-md transition-shadow p-6"
          >
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-lg font-semibold text-gray-900 flex-1 pr-4">
                {result.title}
              </h2>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${getConfidenceColor(
                  result.biotools_confidence
                )}`}
              >
                {getConfidenceLabel(result.biotools_confidence)}{' '}
                {result.biotools_confidence?.toFixed(0)}%
              </span>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-3">
              <span className="font-medium text-blue-600">
                {result.org_name}
              </span>
              {result.org_city && result.org_state && (
                <span>
                  {result.org_city}, {result.org_state}
                </span>
              )}
              {result.org_type && (
                <span className="capitalize">{result.org_type}</span>
              )}
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-500">
              <span>Project: {result.project_number}</span>
              {result.fiscal_year && <span>FY{result.fiscal_year}</span>}
              {result.total_cost && (
                <span>{formatCost(result.total_cost)}</span>
              )}
              {result.funding_mechanism && (
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                  {result.funding_mechanism}
                </span>
              )}
            </div>

            {result.phr && (
              <p className="mt-3 text-sm text-gray-600 line-clamp-2">
                {result.phr}
              </p>
            )}
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 text-gray-700"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50 text-gray-700"
          >
            Next
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No results found. Try adjusting your filters.</p>
        </div>
      )}
    </main>
  )
}

function SearchLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="animate-pulse">
        <div className="h-12 bg-gray-200 rounded-lg mb-8"></div>
        <div className="h-20 bg-gray-200 rounded-lg mb-6"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    </main>
  )
}

export default function SearchPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-blue-600">
              granted.bio
            </Link>
            <span className="text-sm text-gray-500">
              Life Sciences Grant Intelligence
            </span>
          </div>
        </div>
      </header>

      <Suspense fallback={<SearchLoading />}>
        <SearchContent />
      </Suspense>
    </div>
  )
}
