'use client'

// Admin credit-mint modal. Grants N free generation credits to a
// target user with a required note field. Companion to Stripe
// promotion codes — codes are self-serve at checkout, this is the
// fully off-Stripe path for one-off comps (press, beta rewards, hand-
// picked BD gifts) where we don't want to route the target through
// the checkout flow at all.
//
// Backend contract: POST /api/admin/grant-credits with
// { userId, count, note }. Response returns { granted, creditIds,
// targetEmail } on success or { error } with 4xx/5xx on failure.

import { useState } from 'react'
import { X, Loader2, Check, AlertTriangle } from 'lucide-react'

interface GrantCreditsModalProps {
  user: {
    id: string
    email: string
    name: string | null
  }
  onClose: () => void
}

const MAX_CREDITS = 20

export function GrantCreditsModal({ user, onClose }: GrantCreditsModalProps) {
  const [count, setCount] = useState<number>(1)
  const [note, setNote] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ granted: number } | null>(null)

  const canSubmit = count >= 1 && count <= MAX_CREDITS && note.trim().length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/admin/grant-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          count,
          note: note.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSuccess({ granted: data.granted ?? count })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grant failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Grant analysis credits</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              To <span className="font-medium">{user.name || user.email}</span> ({user.email})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {success ? (
            // Terminal success state — a re-grant needs a re-open so
            // the operator has a moment to notice what they just did
            // before triggering another one.
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-emerald-600" strokeWidth={2} />
              </div>
              <p className="text-sm text-gray-900 font-medium mb-1">
                Granted {success.granted} credit{success.granted === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-gray-500 mb-5">
                {user.email} now has {success.granted} additional generation credit
                {success.granted === 1 ? '' : 's'}. They&apos;ll see them next time they land on{' '}
                <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">/analyze</code>.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="credit-count" className="block text-xs font-medium text-gray-700 mb-1">
                  Number of credits
                </label>
                <input
                  id="credit-count"
                  type="number"
                  min={1}
                  max={MAX_CREDITS}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(MAX_CREDITS, parseInt(e.target.value) || 1)))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  disabled={submitting}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  1–{MAX_CREDITS} per grant. Each credit is one analysis, expires 12 months.
                </p>
              </div>

              <div>
                <label htmlFor="credit-note" className="block text-xs font-medium text-gray-700 mb-1">
                  Note <span className="text-red-500">*</span>
                </label>
                <input
                  id="credit-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder='e.g., "press: TechCrunch briefing" or "beta reward: 2026-08 review"'
                  maxLength={200}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  disabled={submitting}
                  required
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Required. Lands in the credit ledger for audit reconciliation.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Granting…
                    </>
                  ) : (
                    <>
                      Grant {count} credit{count === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
