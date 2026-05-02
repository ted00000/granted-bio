'use client'

import { useState, useEffect, useCallback } from 'react'

const CATEGORIES = [
  { key: 'biotools', label: 'Biotools', color: 'bg-green-100 text-green-800 border-green-300' },
  { key: 'infrastructure', label: 'Infrastructure', color: 'bg-slate-100 text-slate-800 border-slate-300' },
  { key: 'basic_research', label: 'Basic Research', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  { key: 'therapeutics', label: 'Therapeutics', color: 'bg-rose-100 text-rose-800 border-rose-300' },
  { key: 'diagnostics', label: 'Diagnostics', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  { key: 'medical_device', label: 'Medical Device', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  { key: 'digital_health', label: 'Digital Health', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  { key: 'training', label: 'Training', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  { key: 'other', label: 'Other', color: 'bg-gray-100 text-gray-800 border-gray-300' },
]

const REASON_CODES = [
  { value: '', label: '— No reason —' },
  { value: 'activity_code_misleading', label: 'Activity code misleading' },
  { value: 'abstract_describes_development', label: 'Abstract describes tool development' },
  { value: 'narrow_scope', label: 'Narrow scope, not consortium/shared' },
  { value: 'other', label: 'Other (see notes)' },
]

interface QueueItem {
  application_id: string
  project_number: string
  activity_code: string | null
  title: string
  org_name: string | null
  primary_category: string
  primary_category_confidence: number | null
  fiscal_year: number | null
  abstract: string | null
}

interface Boundary {
  key: string
  label: string
}

interface QueueResponse {
  boundary: string
  boundary_label: string
  confidence_max: number
  total_matching: number
  reviewed_count: number
  items: QueueItem[]
  boundaries: Boundary[]
}

export default function CategorizationReviewPage() {
  const [boundary, setBoundary] = useState('biotools_infrastructure')
  const [confidenceMax, setConfidenceMax] = useState(80)
  const [queue, setQueue] = useState<QueueResponse | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('')
  const [notes, setNotes] = useState('')
  const [expandedAbstract, setExpandedAbstract] = useState(false)

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        boundary,
        confidence_max: String(confidenceMax),
        limit: '20'
      })
      const res = await fetch(`/api/admin/categorization-review?${params}`)
      if (!res.ok) {
        const data = await res.json()
        const detail = data.details || data.hint || data.code || ''
        throw new Error(`${data.error || 'Failed to load queue'}${detail ? ` — ${detail}` : ''}`)
      }
      const data = await res.json() as QueueResponse
      setQueue(data)
      setCurrentIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [boundary, confidenceMax])

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  // Reset per-item state when item changes
  useEffect(() => {
    setReasonCode('')
    setNotes('')
    setExpandedAbstract(false)
  }, [currentIndex])

  const currentItem = queue?.items[currentIndex] || null

  const submitCorrection = async (correctedCategory: string) => {
    if (!currentItem || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/categorization-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_id: currentItem.application_id,
          corrected_category: correctedCategory,
          reason_code: reasonCode || undefined,
          notes: notes || undefined
        })
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }
      // Move to next, or refresh if at end of page
      if (currentIndex < (queue?.items.length || 0) - 1) {
        setCurrentIndex(currentIndex + 1)
      } else {
        await loadQueue()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const skip = () => {
    if (!currentItem) return
    // Skip = confirm current category, no change
    submitCorrection(currentItem.primary_category)
  }

  // Keyboard shortcuts: 1-9 for categories, S for skip
  useEffect(() => {
    if (!currentItem) return
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9) {
        const cat = CATEGORIES[num - 1]
        if (cat) submitCorrection(cat.key)
      } else if (e.key === 's' || e.key === 'S') {
        skip()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem, reasonCode, notes])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Categorization Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review borderline category classifications and reassign as needed.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="boundary-select" className="block text-xs font-medium text-gray-700 mb-1">Boundary</label>
          <select
            id="boundary-select"
            value={boundary}
            onChange={(e) => setBoundary(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            {(queue?.boundaries || [{ key: boundary, label: boundary }]).map(b => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="confidence-input" className="block text-xs font-medium text-gray-700 mb-1">Max confidence</label>
          <input
            id="confidence-input"
            type="number"
            min="0"
            max="100"
            value={confidenceMax}
            onChange={(e) => setConfidenceMax(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white w-24"
          />
        </div>
        <button
          onClick={loadQueue}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh queue'}
        </button>
        {queue && (
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-medium">{queue.items.length}</span> in this page
            {' · '}
            <span className="font-medium">{queue.reviewed_count}</span> reviewed total
          </div>
        )}
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading queue…</div>
      ) : !currentItem ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-700 font-medium">All caught up.</p>
          <p className="mt-1 text-sm text-gray-500">No more items match this filter. Try a different boundary or raise the confidence threshold.</p>
        </div>
      ) : (
        <>
          {/* Project card */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="text-xs text-gray-500">
                Item {currentIndex + 1} of {queue?.items.length} on this page
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Confidence:</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  (currentItem.primary_category_confidence || 0) < 50 ? 'bg-rose-100 text-rose-800' :
                  (currentItem.primary_category_confidence || 0) < 75 ? 'bg-amber-100 text-amber-800' :
                  'bg-emerald-100 text-emerald-800'
                }`}>
                  {currentItem.primary_category_confidence !== null ? `${Math.round(currentItem.primary_category_confidence)}%` : 'unknown'}
                </span>
              </div>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 mb-2">{currentItem.title}</h2>

            <div className="flex flex-wrap gap-2 text-sm text-gray-600 mb-4">
              {currentItem.org_name && <span>{currentItem.org_name}</span>}
              {currentItem.activity_code && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{currentItem.activity_code}</span>
                </>
              )}
              {currentItem.fiscal_year && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>FY{currentItem.fiscal_year}</span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span className="font-mono text-xs">{currentItem.application_id}</span>
            </div>

            <div className="mb-4">
              <span className="text-xs text-gray-500 mr-2">Currently:</span>
              <span className={`inline-block px-2.5 py-1 text-xs font-medium rounded border ${
                CATEGORIES.find(c => c.key === currentItem.primary_category)?.color || 'bg-gray-100 text-gray-800 border-gray-300'
              }`}>
                {CATEGORIES.find(c => c.key === currentItem.primary_category)?.label || currentItem.primary_category}
              </span>
            </div>

            {currentItem.abstract && (
              <div>
                <button
                  onClick={() => setExpandedAbstract(!expandedAbstract)}
                  className="text-xs text-blue-600 hover:text-blue-800 mb-1"
                >
                  {expandedAbstract ? 'Collapse' : 'Expand'} abstract
                </button>
                <p className={`text-sm text-gray-700 leading-relaxed whitespace-pre-wrap ${expandedAbstract ? '' : 'line-clamp-6'}`}>
                  {currentItem.abstract}
                </p>
              </div>
            )}
          </div>

          {/* Reason and notes */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label htmlFor="reason-select" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <select
                id="reason-select"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
              >
                {REASON_CODES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notes-input" className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input
                id="notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. P41 funds research at this center but project is tool development"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
              />
            </div>
          </div>

          {/* Category buttons */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-700 mb-3">
              Reassign to <span className="text-xs font-normal text-gray-500">(or press 1-9 / S to skip)</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {CATEGORIES.map((cat, idx) => {
                const isCurrent = cat.key === currentItem.primary_category
                return (
                  <button
                    key={cat.key}
                    onClick={() => submitCorrection(cat.key)}
                    disabled={saving}
                    className={`px-3 py-2 text-sm font-medium rounded-md border transition-all disabled:opacity-50 ${
                      isCurrent
                        ? `${cat.color} ring-2 ring-offset-1 ring-gray-400`
                        : `${cat.color} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300`
                    }`}
                    title={`Press ${idx + 1}`}
                  >
                    <span className="text-xs text-gray-500 mr-1">{idx + 1}</span>
                    {cat.label}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={skip}
                disabled={saving}
                className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                Skip (S) — confirms current category
              </button>
              <span className="text-xs text-gray-400">
                {saving ? 'Saving…' : 'Click a category or press 1-9'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
