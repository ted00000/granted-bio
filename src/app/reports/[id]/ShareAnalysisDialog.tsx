'use client'

// Owner-side dialog for creating + managing share links on a single
// analysis. Two panels:
//
//   1. Create: recipient email + optional message + Share button.
//      Submitting hits POST /api/reports/[id]/shares, which mints a
//      token and (if an email was supplied) fires the recipient email
//      via Resend. The freshly-minted URL is surfaced immediately so
//      the owner can also copy-paste it into Slack / a DM / etc.
//
//   2. Manage: chronological list of prior shares for this report,
//      newest first. Each row shows recipient (or "Link only" when no
//      email was captured), view count, expiration state, and a
//      Revoke action. Revoked/expired rows stay visible in a dimmed
//      state so the buyer can audit "what did I share with whom."
//
// The dialog is deliberately transactional — no analytics dashboard,
// no geography, no team-seat conversion nudge. Those live in Phase 2.

import { useEffect, useState } from 'react'
import { X, Loader2, Copy, Check, AlertTriangle, ExternalLink, Trash2 } from 'lucide-react'

interface ShareSummary {
  id: string
  reportId: string
  recipientEmail: string | null
  senderMessage: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  viewCount: number
  lastViewedAt: string | null
  url: string
}

interface ShareAnalysisDialogProps {
  reportId: string
  reportTopic: string | null
  onClose: () => void
}

export function ShareAnalysisDialog({
  reportId,
  reportTopic,
  onClose,
}: ShareAnalysisDialogProps) {
  const [recipientEmail, setRecipientEmail] = useState('')
  const [senderMessage, setSenderMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shares, setShares] = useState<ShareSummary[]>([])
  const [loadingShares, setLoadingShares] = useState(true)
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [justCreatedShareId, setJustCreatedShareId] = useState<string | null>(null)

  useEffect(() => {
    void loadShares()
    // Report topic doesn't change per-open, so no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadShares = async () => {
    setLoadingShares(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/shares`)
      const data = await res.json()
      if (Array.isArray(data.shares)) {
        setShares(data.shares as ShareSummary[])
      }
    } catch (e) {
      console.error('[share dialog] load failed:', e)
    } finally {
      setLoadingShares(false)
    }
  }

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, string> = {}
      if (recipientEmail.trim()) body.recipientEmail = recipientEmail.trim()
      if (senderMessage.trim()) body.senderMessage = senderMessage.trim()

      const res = await fetch(`/api/reports/${reportId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to create share')
      }
      const share = data.share as ShareSummary
      setShares((prev) => [share, ...prev])
      setJustCreatedShareId(share.id)
      setRecipientEmail('')
      setSenderMessage('')
      // Auto-copy the newly minted URL as a courtesy — the most
      // common next action is pasting it somewhere anyway.
      void copyUrl(share)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create share')
    } finally {
      setSubmitting(false)
    }
  }

  const copyUrl = async (share: ShareSummary) => {
    try {
      await navigator.clipboard.writeText(share.url)
      setCopiedShareId(share.id)
      setTimeout(() => setCopiedShareId(null), 2000)
    } catch (e) {
      console.error('[share dialog] copy failed:', e)
    }
  }

  const handleRevoke = async (share: ShareSummary) => {
    if (!confirm('Revoke this share link? Anyone currently holding it will lose access immediately.')) {
      return
    }
    setRevokingId(share.id)
    try {
      const res = await fetch(`/api/shares/${share.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to revoke')
      setShares((prev) =>
        prev.map((s) =>
          s.id === share.id ? { ...s, revokedAt: new Date().toISOString() } : s
        )
      )
    } catch (e) {
      console.error('[share dialog] revoke failed:', e)
      alert('Failed to revoke share. Please try again.')
    } finally {
      setRevokingId(null)
    }
  }

  const activeShares = shares.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date())
  const inactiveShares = shares.filter((s) => s.revokedAt || new Date(s.expiresAt) <= new Date())

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 id="share-dialog-title" className="text-lg font-semibold text-gray-900">
              Share this analysis
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Recipients see the full interactive analysis — no login required.
              Links expire after 60 days and can be revoked anytime.
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

        <div className="flex-1 overflow-y-auto p-5">
          {/* Create panel */}
          <form onSubmit={handleCreate} className="space-y-3 pb-5 border-b border-gray-100">
            <div>
              <label htmlFor="recipient-email" className="block text-xs font-medium text-gray-700 mb-1">
                Share with a colleague
                <span className="text-gray-400 font-normal ml-1">(optional — leave blank to just copy a link)</span>
              </label>
              <input
                id="recipient-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="sender-message" className="block text-xs font-medium text-gray-700 mb-1">
                Message
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <textarea
                id="sender-message"
                value={senderMessage}
                onChange={(e) => setSenderMessage(e.target.value)}
                placeholder={reportTopic ? `Thought you'd find this interesting — ${reportTopic}` : "Add a short note..."}
                rows={2}
                maxLength={2000}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#E07A5F] focus:ring-2 focus:ring-[#E07A5F]/20 resize-none"
                disabled={submitting}
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors disabled:bg-gray-200 disabled:text-gray-400"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Creating link...
                  </>
                ) : recipientEmail.trim() ? (
                  <>Send + create link</>
                ) : (
                  <>Create link</>
                )}
              </button>
            </div>
          </form>

          {/* Manage panel */}
          <div className="pt-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {activeShares.length === 0 && inactiveShares.length === 0
                ? 'No shares yet'
                : `Active shares (${activeShares.length})`}
            </div>

            {loadingShares ? (
              <div className="flex items-center justify-center py-6 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                You haven&apos;t shared this analysis with anyone yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {activeShares.map((s) => (
                  <ShareRow
                    key={s.id}
                    share={s}
                    isCopied={copiedShareId === s.id}
                    isRevoking={revokingId === s.id}
                    isNew={justCreatedShareId === s.id}
                    onCopy={() => copyUrl(s)}
                    onRevoke={() => handleRevoke(s)}
                  />
                ))}
                {inactiveShares.length > 0 && (
                  <>
                    <div className="pt-4 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      Inactive ({inactiveShares.length})
                    </div>
                    {inactiveShares.map((s) => (
                      <ShareRow
                        key={s.id}
                        share={s}
                        isCopied={false}
                        isRevoking={revokingId === s.id}
                        isNew={false}
                        onCopy={() => copyUrl(s)}
                        onRevoke={() => handleRevoke(s)}
                      />
                    ))}
                  </>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Manage-list row. Extracted so the two loops above stay clean.
// ------------------------------------------------------------------

function ShareRow({
  share,
  isCopied,
  isRevoking,
  isNew,
  onCopy,
  onRevoke,
}: {
  share: ShareSummary
  isCopied: boolean
  isRevoking: boolean
  isNew: boolean
  onCopy: () => void
  onRevoke: () => void
}) {
  const isRevoked = !!share.revokedAt
  const isExpired = !isRevoked && new Date(share.expiresAt) <= new Date()
  const isActive = !isRevoked && !isExpired

  const stateLabel = isRevoked
    ? 'Revoked'
    : isExpired
      ? 'Expired'
      : `Expires ${new Date(share.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        isNew
          ? 'border-[#E07A5F] bg-[#FDF2EF]/60'
          : isActive
            ? 'border-gray-200 bg-white'
            : 'border-gray-100 bg-gray-50/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 flex-1 ${isActive ? '' : 'opacity-60'}`}>
          <div className="text-sm text-gray-900 font-medium truncate">
            {share.recipientEmail ?? 'Link only'}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{stateLabel}</span>
            <span className="text-gray-300">•</span>
            <span>
              {share.viewCount} view{share.viewCount === 1 ? '' : 's'}
            </span>
            {share.lastViewedAt && (
              <>
                <span className="text-gray-300">•</span>
                <span>
                  Last viewed{' '}
                  {new Date(share.lastViewedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isActive && (
            <>
              <button
                onClick={onCopy}
                className="p-1.5 text-gray-400 hover:text-[#E07A5F] hover:bg-white rounded-md transition-colors"
                title="Copy share URL"
              >
                {isCopied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <a
                href={share.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 text-gray-400 hover:text-[#E07A5F] hover:bg-white rounded-md transition-colors"
                title="Open share URL in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={onRevoke}
                disabled={isRevoking}
                className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-white rounded-md transition-colors disabled:opacity-50"
                title="Revoke this share"
              >
                {isRevoking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
