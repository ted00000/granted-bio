'use client'

import { useState } from 'react'
import { X, AlertTriangle, Loader2, FileText } from 'lucide-react'

interface GenerateReportDialogProps {
  onClose: () => void
  onGenerated: () => void
}

export function GenerateReportDialog({
  onClose,
  onGenerated,
}: GenerateReportDialogProps) {
  const [topic, setTopic] = useState('')
  const [step, setStep] = useState<'input' | 'checking' | 'confirm' | 'generating'>('input')
  const [projectCount, setProjectCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checkTopic = async () => {
    if (!topic.trim()) return

    setStep('checking')
    setError(null)

    try {
      const response = await fetch(
        `/api/reports/check-topic?topic=${encodeURIComponent(topic.trim())}`
      )
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to check topic')
      }

      setProjectCount(data.project_count)

      if (data.project_count < 5) {
        setStep('confirm')
      } else {
        // Enough data, proceed directly
        await generateReport(false)
      }
    } catch (e) {
      console.error('Error checking topic:', e)
      setError(e instanceof Error ? e.message : 'Failed to check topic')
      setStep('input')
    }
  }

  const generateReport = async (dataLimited: boolean) => {
    setStep('generating')
    setError(null)

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_type: 'topic',
          topic: topic.trim(),
          data_limited: dataLimited,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate report')
      }

      onGenerated()
    } catch (e) {
      console.error('Error generating report:', e)
      setError(e instanceof Error ? e.message : 'Failed to generate report')
      setStep('input')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            Generate Intelligence Report
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {step === 'input' && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Create comprehensive topic-focused intelligence reports synthesizing research activity, funding, clinical trials, patents, and publications.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Research Topic
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., CAR-T cell therapy, CRISPR gene editing"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') checkTopic()
                }}
              />
              {error && (
                <p className="mt-2 text-sm text-rose-600">{error}</p>
              )}
            </>
          )}

          {step === 'checking' && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="w-8 h-8 text-[#E07A5F] animate-spin mb-3" />
              <p className="text-gray-600">Checking available data...</p>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-800">Limited Data Available</p>
                  <p className="text-sm text-amber-700 mt-1">
                    We found only <strong>{projectCount}</strong> projects for
                    &ldquo;{topic}&rdquo;. The report will have limited depth.
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Would you like to proceed with generating a report anyway?
              </p>
            </div>
          )}

          {step === 'generating' && (
            <div className="flex flex-col items-center py-8">
              <div className="relative mb-4">
                <FileText className="w-12 h-12 text-[#E07A5F]" strokeWidth={1.5} />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
                </div>
              </div>
              <p className="text-gray-900 font-medium mb-1">Generating Report</p>
              <p className="text-sm text-gray-500 text-center">
                This may take a few minutes. You can close this dialog
                and check back later.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {step === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={checkTopic}
                disabled={!topic.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Report
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => generateReport(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors"
              >
                Proceed with Limited Data
              </button>
            </>
          )}

          {step === 'generating' && (
            <button
              onClick={onGenerated}
              className="px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
