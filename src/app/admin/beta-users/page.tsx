'use client'

import { useState, useEffect, useCallback } from 'react'

interface Invite {
  id: string
  email: string
  invited_at: string
  claimed_at: string | null
  claimed_by_user_id: string | null
  notes: string | null
  tier: string | null
  beta_expires_at: string | null
  reports_used: number
}

const formatDate = (s: string | null): string => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const daysRemaining = (expiresAt: string | null): number | null => {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export default function BetaUsersPage() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [emailInput, setEmailInput] = useState('')
  const [notesInput, setNotesInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/beta-invites')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to load')
      }
      const data = await res.json()
      setInvites(data.invites)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const addInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!emailInput.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/beta-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.trim(), notes: notesInput.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add invite')
      }
      setEmailInput('')
      setNotesInput('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add invite')
    } finally {
      setSubmitting(false)
    }
  }

  const removeInvite = async (id: string, email: string) => {
    if (!confirm(`Remove beta access for ${email}? If they've claimed it, they'll be reverted to free tier.`)) {
      return
    }
    try {
      const res = await fetch(`/api/admin/beta-invites?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to remove')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Beta Users</h1>
        <p className="mt-1 text-sm text-gray-500">
          Email allowlist for beta access. Beta users get pro-tier search limits, 14 days from first sign-in, and a lifetime cap of 3 reports.
        </p>
      </div>

      {/* Add invite form */}
      <div className="bg-white rounded-lg shadow p-5">
        <form onSubmit={addInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="beta-email" className="block text-xs font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="beta-email"
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="user@example.com"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="beta-notes" className="block text-xs font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <input
              id="beta-notes"
              type="text"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="e.g. CS lead at Acme"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !emailInput.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add invite'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-md px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Invites table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Invites</h2>
          <span className="text-xs text-gray-500">
            {invites.filter((i) => i.claimed_at).length} of {invites.length} claimed
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        ) : invites.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No invites yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Reports</th>
                <th className="px-5 py-3">Expires</th>
                <th className="px-5 py-3">Notes</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invites.map((inv) => {
                const days = daysRemaining(inv.beta_expires_at)
                const isExpired = days !== null && days <= 0
                const isPending = !inv.claimed_at
                return (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{inv.email}</td>
                    <td className="px-5 py-3">
                      {isPending ? (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800">
                          Pending
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">
                          Expired
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-800">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {inv.claimed_at ? `${inv.reports_used} of 3` : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {inv.beta_expires_at ? (
                        <>
                          {formatDate(inv.beta_expires_at)}
                          {days !== null && !isExpired && (
                            <span className="ml-1 text-xs text-gray-500">({days}d left)</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs max-w-xs truncate">
                      {inv.notes || '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => removeInvite(inv.id, inv.email)}
                        className="text-xs text-rose-600 hover:text-rose-800 transition-colors"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
