'use client'

import { useState } from 'react'

const CATEGORIES = [
  { value: 'training', label: 'Training' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'basic_research', label: 'Basic Research' },
  { value: 'biotools', label: 'Biotools' },
  { value: 'therapeutics', label: 'Therapeutics' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'medical_device', label: 'Medical Device' },
  { value: 'digital_health', label: 'Digital Health' },
  { value: 'other', label: 'Other' }
]

interface CategoryEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (category: string, confidence: number) => Promise<void>
  currentCategory: string | null
  currentConfidence: number | null
  projectTitle: string
}

export function CategoryEditModal({
  isOpen,
  onClose,
  onSave,
  currentCategory,
  currentConfidence,
  projectTitle
}: CategoryEditModalProps) {
  const [category, setCategory] = useState(currentCategory || 'other')
  const [confidence, setConfidence] = useState(currentConfidence || 75)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave(category, confidence)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Category</h2>
          <p className="text-sm text-gray-500 mt-1 truncate">{projectTitle}</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Confidence: {confidence}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfidence(50)}
              className={`flex-1 px-3 py-1.5 text-sm rounded ${
                confidence >= 40 && confidence < 60
                  ? 'bg-yellow-100 text-yellow-800 border-2 border-yellow-400'
                  : 'bg-gray-100 text-gray-600 border border-gray-300'
              }`}
            >
              Low (50)
            </button>
            <button
              type="button"
              onClick={() => setConfidence(75)}
              className={`flex-1 px-3 py-1.5 text-sm rounded ${
                confidence >= 60 && confidence < 85
                  ? 'bg-blue-100 text-blue-800 border-2 border-blue-400'
                  : 'bg-gray-100 text-gray-600 border border-gray-300'
              }`}
            >
              Medium (75)
            </button>
            <button
              type="button"
              onClick={() => setConfidence(95)}
              className={`flex-1 px-3 py-1.5 text-sm rounded ${
                confidence >= 85
                  ? 'bg-green-100 text-green-800 border-2 border-green-400'
                  : 'bg-gray-100 text-gray-600 border border-gray-300'
              }`}
            >
              High (95)
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
