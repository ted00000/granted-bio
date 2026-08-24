// Analysis-share token utilities. Owns everything that touches the
// analysis_shares table so the API routes + middleware + fetch-report
// helper stay small and don't duplicate query logic.
//
// Every function here uses the service-role client (supabaseAdmin)
// because:
//   * Middleware needs to validate tokens for anonymous visitors
//     (recipients of a shared link — no session).
//   * The view-count bump on /share/[token] runs against a table the
//     recipient can't write to under any RLS policy.
//   * Owner-side operations (mint/list/revoke) do their own
//     ownership check *before* calling in here, so a service-role
//     write is safe by the time we get to it.

import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

// 60-day default. Long enough for typical evaluation cycles (grant
// discussions, IC memos, partner intros) — short enough that a stale
// snapshot doesn't linger on someone's Slack forever pretending to be
// current intel.
export const SHARE_TOKEN_DEFAULT_TTL_DAYS = 60

// Custom request header the middleware sets after validating a
// /share/[token] URL. Server components read it to know:
//   1. To bypass user auth in getReport.
//   2. To render in read-only mode with the attribution bar.
// Prefixed x-granted- to make it obviously ours in server logs.
export const SHARE_TOKEN_HEADER = 'x-granted-share-token'
export const SHARE_REPORT_ID_HEADER = 'x-granted-share-report-id'

export interface AnalysisShareRow {
  id: string
  report_id: string
  owner_user_id: string
  token: string
  recipient_email: string | null
  sender_message: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  view_count: number
  last_viewed_at: string | null
}

export interface ShareSummary {
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

/**
 * Generate a URL-safe, 32-byte random token. Base64url encoding (no
 * padding, no /+= that need URL encoding) so the token drops straight
 * into a path segment without escaping.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Mint a new share row for `reportId` owned by `ownerUserId`. Caller
 * is responsible for verifying ownership before calling — this helper
 * does not re-check because it also runs from the API route where the
 * check has just happened.
 *
 * Returns the created row so the caller can immediately serialize it
 * into the API response (including the shareable URL).
 */
export async function createShare(params: {
  reportId: string
  ownerUserId: string
  recipientEmail: string | null
  senderMessage: string | null
  ttlDays?: number
}): Promise<AnalysisShareRow> {
  const ttlDays = params.ttlDays ?? SHARE_TOKEN_DEFAULT_TTL_DAYS
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

  // Retry once on the astronomically-unlikely token collision so a
  // bad birthday-problem run doesn't 500 the request. Anything beyond
  // that is either an RNG failure worth investigating or a bug —
  // don't paper over it with an infinite loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = generateShareToken()
    const { data, error } = await supabaseAdmin
      .from('analysis_shares')
      .insert({
        report_id: params.reportId,
        owner_user_id: params.ownerUserId,
        token,
        recipient_email: params.recipientEmail,
        sender_message: params.senderMessage,
        expires_at: expiresAt,
      })
      .select('*')
      .single()

    if (!error && data) return data as AnalysisShareRow
    // 23505 = unique_violation. Anything else is real — surface it.
    if (error?.code !== '23505') {
      throw new Error(`Failed to create share: ${error?.message ?? 'unknown error'}`)
    }
  }
  throw new Error('Failed to create share: token collision after retry')
}

/**
 * Look up a share by token. Returns null when the token is unknown,
 * revoked, or expired — the caller shouldn't need to distinguish
 * these cases at the boundary (we render the same "link no longer
 * works" page for all of them).
 */
export async function findValidShareByToken(
  token: string
): Promise<AnalysisShareRow | null> {
  const { data, error } = await supabaseAdmin
    .from('analysis_shares')
    .select('*')
    .eq('token', token)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !data) return null
  return data as AnalysisShareRow
}

/**
 * Bump view_count + last_viewed_at for a share. Called from the
 * public /share/[token] loader after we've already confirmed the
 * token is valid. Fire-and-forget from the caller's perspective —
 * if this fails, the recipient still gets their page.
 */
export async function recordShareView(shareId: string): Promise<void> {
  // Postgres doesn't have COALESCE-style atomic increments in the
  // PostgREST update API, so we fetch-then-write. A double-increment
  // under concurrent views is fine: view_count is directional signal,
  // not billing state.
  const { data } = await supabaseAdmin
    .from('analysis_shares')
    .select('view_count')
    .eq('id', shareId)
    .single()
  const current = (data?.view_count as number) ?? 0
  await supabaseAdmin
    .from('analysis_shares')
    .update({
      view_count: current + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', shareId)
}

/**
 * List all shares an owner has minted for a given report, newest
 * first. Includes revoked + expired rows so the manage-shares UI can
 * show them (with a struck-through / dimmed state) for auditability.
 */
export async function listSharesForReport(params: {
  reportId: string
  ownerUserId: string
}): Promise<AnalysisShareRow[]> {
  const { data, error } = await supabaseAdmin
    .from('analysis_shares')
    .select('*')
    .eq('report_id', params.reportId)
    .eq('owner_user_id', params.ownerUserId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data as AnalysisShareRow[]
}

/**
 * Soft-revoke a share. Owner check is done at the API route layer
 * before calling; this helper just does the write.
 */
export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('analysis_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
  if (error) {
    throw new Error(`Failed to revoke share: ${error.message}`)
  }
}

/**
 * Build a full shareable URL from a token. Prefers NEXT_PUBLIC_APP_URL
 * (set in prod to https://www.granted.bio) and falls back to a
 * localhost dev default so the API route works out of the box.
 */
export function buildShareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/share/${token}`
}

/** Serialize a DB row into the shape the client sees in the manage-shares UI. */
export function toShareSummary(row: AnalysisShareRow): ShareSummary {
  return {
    id: row.id,
    reportId: row.report_id,
    recipientEmail: row.recipient_email,
    senderMessage: row.sender_message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at,
    url: buildShareUrl(row.token),
  }
}
