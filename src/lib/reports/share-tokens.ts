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

import { createHmac, randomBytes } from 'crypto'
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
  sender_display_name: string | null
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
  senderDisplayName: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  viewCount: number
  uniqueViewerCount: number
  firstViewedAt: string | null
  lastViewedAt: string | null
  countries: string[]
  url: string
}

/**
 * Aggregate view analytics for a single share, computed from the
 * per-view rows in `share_views`. Kept as a separate query (rather
 * than baked into the shares GET join) because most page loads only
 * want the basic list — the manage-shares dialog is the only surface
 * that renders unique-viewer counts and country breakdowns.
 */
export interface ShareViewAnalytics {
  uniqueViewerCount: number
  firstViewedAt: string | null
  countries: string[]
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
  senderDisplayName?: string | null
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
        sender_display_name: params.senderDisplayName ?? null,
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

interface ViewRequestFingerprint {
  /** Best-effort client IP from x-forwarded-for / x-real-ip. */
  ip: string
  /** User-Agent header. Used together with IP to approximate uniqueness. */
  userAgent: string
  /** ISO-3166-1 alpha-2. 'ZZ' when unknown (dev, non-Vercel host). */
  country: string
}

/**
 * Bump view_count + last_viewed_at on the share row AND append a
 * per-view record to share_views. Called from the public
 * /share/[token] loader after the token has been validated.
 *
 * The per-view row lets the owner see unique viewer counts, first
 * viewed timestamp, and a coarse country list without us keeping
 * raw IP / UA data. viewer_hash = HMAC-SHA256 of a server-side
 * secret + `${ip}::${ua}` — deterministic per (viewer, share) so
 * repeat visits from the same viewer collapse into one unique, but
 * the input isn't recoverable if the DB leaks.
 */
export async function recordShareView(
  shareId: string,
  fingerprint: ViewRequestFingerprint
): Promise<void> {
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

  // Fire both writes in parallel — bumping the share row's aggregate
  // counters and appending the per-view detail row are independent,
  // and page-render latency budget is tight.
  await Promise.all([
    supabaseAdmin
      .from('analysis_shares')
      .update({
        view_count: current + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('id', shareId),
    supabaseAdmin.from('share_views').insert({
      share_id: shareId,
      viewer_hash: hashViewer(fingerprint.ip, fingerprint.userAgent),
      country: normalizeCountry(fingerprint.country),
    }),
  ])
}

/**
 * Compute a stable, non-reversible hash for a (ip, ua) pair using an
 * HMAC keyed by SHARE_ANALYTICS_HMAC_KEY. The key is deployment-wide
 * (all shares use the same one), which is intentional — it doesn't
 * need to be per-share, and rotating it would just reset unique
 * viewer counts across all shares uniformly.
 *
 * Falls back to a random per-request value if the env var is unset
 * (dev machines that haven't set it) so unique-viewer analytics
 * degrades gracefully to over-counting instead of blowing up.
 */
function hashViewer(ip: string, userAgent: string): string {
  const key = process.env.SHARE_ANALYTICS_HMAC_KEY
  if (!key) {
    // Random fallback — every view registers as a new viewer, which
    // is wrong but safe. Real deploys should always set the key.
    return randomBytes(16).toString('hex')
  }
  return createHmac('sha256', key)
    .update(`${ip}::${userAgent}`)
    .digest('hex')
}

/** Constrain to two-letter uppercase; default 'ZZ' when we can't tell. */
function normalizeCountry(country: string): string {
  const trimmed = (country || '').trim().toUpperCase()
  if (trimmed.length === 2 && /^[A-Z]{2}$/.test(trimmed)) return trimmed
  return 'ZZ'
}

/**
 * Aggregate view analytics for a single share. Returns zero-values
 * when the share has no views yet.
 */
export async function getShareViewAnalytics(shareId: string): Promise<ShareViewAnalytics> {
  const { data } = await supabaseAdmin
    .from('share_views')
    .select('viewer_hash, country, viewed_at')
    .eq('share_id', shareId)
    .order('viewed_at', { ascending: true })

  if (!data || data.length === 0) {
    return { uniqueViewerCount: 0, firstViewedAt: null, countries: [] }
  }

  const rows = data as Array<{ viewer_hash: string; country: string; viewed_at: string }>
  const uniqueHashes = new Set<string>()
  const countrySet = new Set<string>()
  for (const r of rows) {
    uniqueHashes.add(r.viewer_hash)
    if (r.country && r.country !== 'ZZ') countrySet.add(r.country)
  }
  return {
    uniqueViewerCount: uniqueHashes.size,
    firstViewedAt: rows[0].viewed_at,
    countries: [...countrySet].sort(),
  }
}

/**
 * Batched aggregate for a list of shares. Used by the manage-shares
 * list so the dialog can show unique / first / countries without
 * N+1 querying share_views once per row.
 */
export async function getShareViewAnalyticsBatch(
  shareIds: string[]
): Promise<Record<string, ShareViewAnalytics>> {
  const out: Record<string, ShareViewAnalytics> = {}
  for (const id of shareIds) {
    out[id] = { uniqueViewerCount: 0, firstViewedAt: null, countries: [] }
  }
  if (shareIds.length === 0) return out

  const { data } = await supabaseAdmin
    .from('share_views')
    .select('share_id, viewer_hash, country, viewed_at')
    .in('share_id', shareIds)
    .order('viewed_at', { ascending: true })

  if (!data) return out

  const rows = data as Array<{
    share_id: string
    viewer_hash: string
    country: string
    viewed_at: string
  }>

  const bySharehash = new Map<string, Set<string>>()
  const byShareCountries = new Map<string, Set<string>>()
  const firstSeen = new Map<string, string>()

  for (const r of rows) {
    if (!bySharehash.has(r.share_id)) bySharehash.set(r.share_id, new Set())
    bySharehash.get(r.share_id)!.add(r.viewer_hash)

    if (!byShareCountries.has(r.share_id)) byShareCountries.set(r.share_id, new Set())
    if (r.country && r.country !== 'ZZ') {
      byShareCountries.get(r.share_id)!.add(r.country)
    }

    if (!firstSeen.has(r.share_id)) firstSeen.set(r.share_id, r.viewed_at)
  }

  for (const id of shareIds) {
    out[id] = {
      uniqueViewerCount: bySharehash.get(id)?.size ?? 0,
      firstViewedAt: firstSeen.get(id) ?? null,
      countries: [...(byShareCountries.get(id) ?? [])].sort(),
    }
  }
  return out
}

// ------------------------------------------------------------------
// Rate limiting
// ------------------------------------------------------------------

/**
 * Sliding-window rate limit for share-token resolution. 20 was too
 * tight (2026-08-31) — real recipient sessions triggered 429s
 * after ~10 clicks because Next.js App Router navigation fires 3–5
 * requests per click (page load + RSC payload + prefetches). 200 is
 * loose enough for a legitimate reader browsing a dozen sections
 * and tight enough that a scraper hammering the endpoint still hits
 * a wall within seconds.
 *
 * The window resets when the caller's row is older than
 * SHARE_RATE_LIMIT_WINDOW_MS. On reset we UPDATE the row atomically
 * — a colliding request from the same IP might undercount for that
 * transition second, but that's fine for anti-abuse purposes.
 */
export const SHARE_RATE_LIMIT_MAX = 200
export const SHARE_RATE_LIMIT_WINDOW_MS = 60 * 1000

export async function checkShareRateLimit(ip: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (!ip || ip === 'unknown') {
    // Fail-open on missing IP — hitting the middleware without one
    // is either a misconfig or a dev tool; refuse to construct a
    // universal limit that hits everyone.
    return { ok: true }
  }

  const nowMs = Date.now()
  const windowStart = new Date(nowMs).toISOString()

  const { data } = await supabaseAdmin
    .from('share_rate_limits')
    .select('window_started_at, count')
    .eq('ip', ip)
    .maybeSingle()

  if (!data) {
    // First hit — insert a fresh window.
    await supabaseAdmin
      .from('share_rate_limits')
      .insert({ ip, window_started_at: windowStart, count: 1 })
    return { ok: true }
  }

  const windowStartedAt = new Date(data.window_started_at as string).getTime()
  const windowExpired = nowMs - windowStartedAt >= SHARE_RATE_LIMIT_WINDOW_MS

  if (windowExpired) {
    await supabaseAdmin
      .from('share_rate_limits')
      .update({ window_started_at: windowStart, count: 1 })
      .eq('ip', ip)
    return { ok: true }
  }

  const currentCount = (data.count as number) ?? 0
  if (currentCount >= SHARE_RATE_LIMIT_MAX) {
    const retryAfterMs = SHARE_RATE_LIMIT_WINDOW_MS - (nowMs - windowStartedAt)
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }

  await supabaseAdmin
    .from('share_rate_limits')
    .update({ count: currentCount + 1 })
    .eq('ip', ip)
  return { ok: true }
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
 * Return an active (non-revoked, non-expired) share for this report
 * if one exists, otherwise mint a new one with no recipient. Used
 * by the PDF exec-summary generator so every downloaded PDF carries
 * a working "view full analysis" link back to the portal without
 * requiring the owner to open the share dialog first.
 *
 * Prefer the most recent active share (that's what the owner
 * probably means when they think "the link for this report"). Never
 * creates duplicates when one already exists.
 */
export async function getOrCreateActiveShareForReport(params: {
  reportId: string
  ownerUserId: string
}): Promise<AnalysisShareRow> {
  const { data } = await supabaseAdmin
    .from('analysis_shares')
    .select('*')
    .eq('report_id', params.reportId)
    .eq('owner_user_id', params.ownerUserId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data) return data as AnalysisShareRow

  return createShare({
    reportId: params.reportId,
    ownerUserId: params.ownerUserId,
    recipientEmail: null,
    senderMessage: null,
  })
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

/**
 * Serialize a DB row into the shape the client sees in the
 * manage-shares UI. `analytics` is optional — when absent the
 * summary reads zero for unique-viewer + first-viewed + countries,
 * which is correct only for freshly-minted shares. The share-list
 * API path passes real analytics; the create-share response path
 * (where the share is brand new and can't have views yet) leaves
 * them off intentionally.
 */
export function toShareSummary(
  row: AnalysisShareRow,
  analytics?: ShareViewAnalytics
): ShareSummary {
  return {
    id: row.id,
    reportId: row.report_id,
    recipientEmail: row.recipient_email,
    senderMessage: row.sender_message,
    senderDisplayName: row.sender_display_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    uniqueViewerCount: analytics?.uniqueViewerCount ?? 0,
    firstViewedAt: analytics?.firstViewedAt ?? null,
    lastViewedAt: row.last_viewed_at,
    countries: analytics?.countries ?? [],
    url: buildShareUrl(row.token),
  }
}
