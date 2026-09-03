// Shared, cached fetcher for a single report row. Used by the report
// portal's layout + every section page so a single request only touches
// the DB once even though multiple server components read from it.
//
// The portal shape (2026-08-11 UI-first pivot, see docs/UI_FIRST_PIVOT_SPEC.md)
// splits what used to be one 2168-line client component into a shell +
// per-section pages. Each page needs (at most) two things: a slice of
// the report data, and confirmation that the current user is allowed to
// see it. Both are handled here so the section pages themselves stay
// small and declarative.

import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  findValidShareByToken,
  recordShareView,
  SHARE_TOKEN_HEADER,
  SHARE_REPORT_ID_HEADER,
  type AnalysisShareRow,
} from './share-tokens'

export interface ReportRow {
  id: string
  user_id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  persona: 'researcher' | 'investor' | null
  status: 'generating' | 'complete' | 'failed'
  project_count: number | null
  data_limited: boolean
  error_message: string | null
  created_at: string
  updated_at: string
  markdown_content: string | null
  executive_summary: string | null
  interpretation: unknown | null
  market_context: unknown | null
  funding_stats: unknown | null
  projects: unknown[] | null
  clinical_trials: unknown[] | null
  patents: unknown[] | null
  publications: unknown[] | null
  top_organizations: unknown[] | null
  top_researchers: unknown[] | null
  /** Full analyzed sample of projects (nullable — populated for
   *  reports generated after 2026-09-01 migration; older reports
   *  fall back to the top-20 `projects` slice for their Data page). */
  all_projects: unknown[] | null
  all_organizations: unknown[] | null
  all_researchers: unknown[] | null
  curated_publications: unknown[] | null
  signals_analysis: unknown | null
  agent_outputs: unknown | null
  /** When TRUE, the report is anon-accessible via /reports/[id]
   *  regardless of user_id. Set only by admins for marketing sample
   *  reports; getReport() honors this flag to skip the auth check. */
  is_public_sample: boolean
}

/**
 * Fetch a report with auth enforcement. Redirects to sign-in for
 * anonymous visitors, returns null if the report belongs to another
 * user (RLS handles both cases at the DB layer — this just wraps it
 * in Next.js navigation semantics).
 *
 * When the request carries a middleware-validated share-token header
 * (a /share/[token] URL rewritten to /reports/[id]/…), we skip auth
 * entirely and fetch via the admin client. Middleware only sets that
 * header after validating token + expiry + revocation, so trusting
 * it here is safe as long as no other code path can spoof it — the
 * request-header set in `NextResponse.rewrite({ request: { headers }})`
 * is only observable to server components, not to client requests.
 *
 * Wrapped in React `cache` so multiple components in the same request
 * (layout + page + nested server components) share one DB round-trip.
 */
export const getReport = cache(async (id: string): Promise<ReportRow | null> => {
  const shareCtx = await getShareContextFromHeaders()

  // Share-mode: middleware already validated the token; use admin
  // client so anonymous recipients can read the row without RLS.
  if (shareCtx && shareCtx.report_id === id) {
    // Fire-and-forget view-count bump + per-view detail. Fails
    // silently — a broken view counter shouldn't 500 the recipient's
    // page load. Fingerprint is pulled from headers the middleware
    // forwarded so we don't have to re-plumb the request.
    const h = await headers()
    void recordShareView(shareCtx.id, {
      ip: h.get('x-granted-share-viewer-ip') || h.get('x-forwarded-for') || 'unknown',
      userAgent: h.get('user-agent') || 'unknown',
      country: h.get('x-vercel-ip-country') || 'ZZ',
    })
    return getReportAsAdmin(id)
  }

  // Public-sample mode: if the row is flagged as a public sample
  // (admins set the flag; not user-facing), allow anon access. The
  // check is a cheap indexed lookup — see the partial index in
  // 20260903_public_sample_flag.sql. Falls through to user auth for
  // every other report.
  const publicSample = await getPublicSampleReport(id)
  if (publicSample) return publicSample

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    // Preserve intended destination for the sign-in flow. Middleware
    // doesn't cover /reports/[id] so we redirect explicitly.
    redirect(`/?redirect=${encodeURIComponent(`/reports/${id}`)}`)
  }
  const { data, error } = await supabase
    .from('user_reports')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return data as ReportRow
})

/**
 * Cached helper: returns the report only if it is flagged as a
 * public sample. Any other row (including reports the caller owns
 * that AREN'T flagged) resolves to null so getReport falls through
 * to the normal user-auth path.
 *
 * Cached so a single request's layout + page + section components
 * only trigger the flag check once per report_id.
 */
export const getPublicSampleReport = cache(async (id: string): Promise<ReportRow | null> => {
  const { data } = await supabaseAdmin
    .from('user_reports')
    .select('*')
    .eq('id', id)
    .eq('is_public_sample', true)
    .maybeSingle()
  return (data as ReportRow) ?? null
})

/**
 * Fetch a report by ID using the admin client, bypassing user auth.
 * Used by the public sample pages that hardcode a report ID and want
 * to render the portal to any visitor. Do NOT expose this to any route
 * that accepts arbitrary IDs from the URL — public sample routes only.
 */
export const getReportAsAdmin = cache(async (id: string): Promise<ReportRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('*')
    .eq('id', id)
    .single()
  if (error || !data) return null
  return data as ReportRow
})

/**
 * Read the middleware-set share-token headers off the current
 * request. Returns null when the caller isn't inside a /share/[token]
 * rewrite (the common case), which lets components fall back to
 * owner-view behavior without an explicit branch.
 *
 * Also re-validates the token against the DB — the middleware already
 * did so, but re-checking here is cheap (indexed lookup on token) and
 * closes the tiny window where a token was valid at middleware time
 * and revoked before the page rendered.
 */
export const getShareContextFromHeaders = cache(async (): Promise<AnalysisShareRow | null> => {
  const h = await headers()
  const token = h.get(SHARE_TOKEN_HEADER)
  const reportId = h.get(SHARE_REPORT_ID_HEADER)
  if (!token || !reportId) return null
  const share = await findValidShareByToken(token)
  if (!share || share.report_id !== reportId) return null
  return share
})
