'use client'

// Admin credit-adjust modal. Grants OR revokes N free generation
// credits for a target user with a required note field. Companion to
// Stripe promotion codes — codes are self-serve at checkout; this is
// the fully off-Stripe path for one-off comps (grant: press, beta
// rewards, BD gifts) and corrections (revoke: duplicate grants, test
// cleanup).
//
// Backend contract — same shape for both:
//   grant:  POST /api/admin/grant-credits   { userId, count, note }
//   revoke: POST /api/admin/revoke-credits  { userId, count, note }
// Responses return { granted }/{ revoked } on success or { error } on
// failure. Revoke returns the ACTUAL number revoked, which may be less
// than requested if the user has fewer available credits.

import { useState } from 'react'
import { X, Loader2, Check, AlertTriangle } from 'lucide-react'

interface GrantCreditsModalProps {
  user: {
    id: string
    email: string
    name: string | null
  }
  mode?: 'grant' | 'revoke'
  onClose: () => void
}

const MAX_CREDITS = 20

export function GrantCreditsModal({ user, mode = 'grant', onClose }: GrantCreditsModalProps) {
  const [count, setCount] = useState<number>(1)
  const [note, setNote] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ count: number } | null>(null)

  const isGrant = mode === 'grant'
  const canSubmit = count >= 1 && count <= MAX_CREDITS && note.trim().length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setError(null)
    setSubmitting(true)

    try {
      const endpoint = isGrant ? '/api/admin/grant-credits' : '/api/admin/revoke-credits'
      const res = await fetch(endpoint, {
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
      setSuccess({ count: (isGrant ? data.granted : data.revoked) ?? count })
    } catch (err) {
      setError(err instanceof Error ? err.message : (isGrant ? 'Grant failed' : 'Revoke failed'))
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
            <h2 className="text-lg font-semibold text-gray-900">
              {isGrant ? 'Grant' : 'Revoke'} analysis credits
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isGrant ? 'To' : 'From'}{' '}
              <span className="font-medium">{user.name || user.email}</span> ({user.email})
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
            // Terminal success state — a re-grant/re-revoke needs a
            // re-open so the operator has a moment to notice what they
            // just did before triggering another one.
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-emerald-600" strokeWidth={2} />
              </div>
              <p className="text-sm text-gray-900 font-medium mb-1">
                {isGrant ? 'Granted' : 'Revoked'} {success.count} credit{success.count === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-gray-500 mb-5">
                {isGrant ? (
                  <>
                    {user.email} now has {success.count} additional generation credit
                    {success.count === 1 ? '' : 's'}. They&apos;ll see the balance next time they land on{' '}
                    <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">/chat</code>.
                  </>
                ) : (
                  <>
                    {success.count} unconsumed credit{success.count === 1 ? '' : 's'} revoked from {user.email}
                    {success.count !== count && (
                      <> (requested {count}; user had only {success.count} available)</>
                    )}
                    . Logged to the ledger for audit.
                  </>
                )}
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
                  placeholder={isGrant
                    ? 'e.g., "press: TechCrunch briefing" or "beta reward: 2026-08 review"'
                    : 'e.g., "duplicate grant", "test cleanup", "accidental grant"'}
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
                  className={`inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:bg-gray-200 disabled:text-gray-400 ${
                    isGrant ? 'bg-gray-900 hover:bg-gray-800' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {isGrant ? 'Granting' : 'Revoking'}…
                    </>
                  ) : (
                    <>
                      {isGrant ? 'Grant' : 'Revoke'} {count} credit{count === 1 ? '' : 's'}
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
