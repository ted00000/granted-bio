// "What should we call you?" step shown to a freshly-authenticated
// user before they reach the actual product surface. Previously only
// the /chat welcome screen captured first name; visitors who signed
// up via the GenerateReportCTA flow and went straight to /reports
// skipped name capture entirely, which left their profile firstName
// null forever.
//
// Drop this in front of any post-auth landing where the dashboard
// assumes a name is available. The component owns its own save +
// refetch — the caller doesn't need to wire anything beyond rendering
// it conditionally on `needsName`.

'use client'

import { useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import { useAuth } from '@/contexts/AuthContext'

interface NameCapturePromptProps {
  /** Optional header copy override. */
  title?: string
  /** Called after the name has been saved + profile refetched. */
  onSaved?: () => void
}

export function NameCapturePrompt({
  title = 'What should we call you?',
  onSaved,
}: NameCapturePromptProps) {
  const { user, refetchProfile } = useAuth()
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createBrowserSupabaseClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || saving) return
    const name = nameInput.trim()
    if (!name) return

    setSaving(true)
    setError(null)
    try {
      const { error: dbError } = await supabase
        .from('user_profiles')
        .update({ first_name: name })
        .eq('id', user.id)
      if (dbError) throw dbError
      await refetchProfile()
      onSaved?.()
    } catch (e) {
      console.error('[NameCapturePrompt] save failed:', e)
      setError('Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-8">
          {title}
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="name-capture-input" className="sr-only">
            Your first name
          </label>
          <input
            id="name-capture-input"
            type="text"
            placeholder="Your first name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            autoFocus
            required
            aria-required="true"
            className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-center text-lg"
          />
          <button
            type="submit"
            disabled={saving || !nameInput.trim()}
            className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
          {error && (
            <p className="text-sm text-rose-600">{error}</p>
          )}
        </form>
      </div>
    </div>
  )
}
