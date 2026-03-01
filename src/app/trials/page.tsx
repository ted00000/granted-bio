'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Activity, Trash2 } from 'lucide-react'

interface SavedTrial {
  id: string
  saved_at: string
  trial: {
    nct_id: string
    study_title: string
    study_status: string | null
    is_therapeutic_trial: boolean
    is_diagnostic_trial: boolean
    project_number: string | null
  }
}

export default function MyTrialsPage() {
  const [trials, setTrials] = useState<SavedTrial[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    fetchTrials()
  }, [])

  const fetchTrials = async () => {
    try {
      const response = await fetch('/api/saved-trials')
      const data = await response.json()
      if (data.trials) {
        setTrials(data.trials)
      }
    } catch (e) {
      console.error('Error fetching saved trials:', e)
    } finally {
      setLoading(false)
    }
  }

  const removeTrial = async (nctId: string) => {
    setRemovingId(nctId)
    try {
      await fetch(`/api/saved-trials?nct_id=${nctId}`, {
        method: 'DELETE'
      })
      setTrials(prev => prev.filter(t => t.trial.nct_id !== nctId))
    } catch (e) {
      console.error('Error removing trial:', e)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <Link href="/chat?persona=trials" className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium">
              ← Back to Trials Search
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3 mb-8">
          <Activity className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-gray-900">My Trials</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          </div>
        ) : trials.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" strokeWidth={1.5} />
            <h2 className="text-lg font-medium text-gray-900 mb-2">No saved trials yet</h2>
            <p className="text-gray-500 mb-6">
              Save clinical trials while browsing to track ones you're interested in.
            </p>
            <Link
              href="/chat?persona=trials"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Search Trials
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {trials.map((item) => {
              const { trial } = item

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                >
                  <a
                    href={`https://clinicaltrials.gov/study/${trial.nct_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0"
                  >
                    <h3 className="text-sm font-medium text-gray-900 leading-snug mb-2 group-hover:text-[#E07A5F] transition-colors">
                      {trial.study_title}
                    </h3>
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                      <span className="text-[#E07A5F] font-medium">
                        {trial.nct_id}
                      </span>
                      {trial.study_status && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span className={`px-1.5 py-0.5 rounded ${
                            trial.study_status === 'RECRUITING' ? 'bg-green-50 text-green-700' :
                            trial.study_status === 'COMPLETED' ? 'bg-blue-50 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {trial.study_status.replace(/_/g, ' ')}
                          </span>
                        </>
                      )}
                      {trial.is_therapeutic_trial && (
                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                          Therapeutic
                        </span>
                      )}
                      {trial.is_diagnostic_trial && (
                        <span className="px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded">
                          Diagnostic
                        </span>
                      )}
                    </div>
                  </a>
                  <button
                    onClick={() => removeTrial(trial.nct_id)}
                    disabled={removingId === trial.nct_id}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                    title="Remove from saved"
                  >
                    {removingId === trial.nct_id ? (
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
