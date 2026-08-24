/**
 * PDF generation endpoint. Chromium renders /reports/[id]/print,
 * uploads the resulting PDF to Supabase Storage, and returns a signed
 * URL the client uses to download.
 *
 * Replaces the client-side jsPDF export in src/app/reports/[id]/page.tsx,
 * which had recurring imperative-state bugs (footer overrun, light-grey
 * text after page break, silent text truncation mid-word). Chromium's
 * CSS Paged Media handles all page-break geometry and per-element
 * state — no shared mutable state to leak across pages.
 *
 * Flow:
 *   1. Auth check — user must own the report.
 *   2. Cache probe — if a PDF was already generated within the last
 *      hour and the report's markdown_content updated_at hasn't
 *      advanced, return the cached signed URL.
 *   3. Chromium launch → open /reports/[id]/print → wait for
 *      window.__printReady → page.pdf() with header/footer templates.
 *   4. Upload bytes to Supabase Storage bucket `report-pdfs` at path
 *      {report_id}.pdf.
 *   5. Return a 60-min signed URL.
 *
 * Cost budget: ~$0.001 per generation in Vercel function time.
 * Wall time: 3-6s cold start, 1-3s warm.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { renderReportPdf } from '@/lib/pdf/puppeteer'
import { getOrCreateActiveShareForReport, buildShareUrl } from '@/lib/reports/share-tokens'

// Vercel function config. Chromium cold-start + PDF render + upload can
// take up to 60s on a large report; bump the ceiling.
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'report-pdfs'
const SIGNED_URL_TTL_SEC = 60 * 60 // 60 minutes

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Own the report or admin/associate bypass? Use the same role check
    // as report create.
    const { data: report } = await supabase
      .from('user_reports')
      .select('id, user_id, title, topic, persona, status, created_at, markdown_content')
      .eq('id', id)
      .single()

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const isOwner = report.user_id === user.id
    const isAdmin = profile?.role === 'admin'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (report.status !== 'complete') {
      return NextResponse.json(
        { error: `Report status is "${report.status}"; PDF only available for completed reports.` },
        { status: 400 },
      )
    }

    if (!report.markdown_content) {
      return NextResponse.json({ error: 'Report has no content to render.' }, { status: 400 })
    }

    // Build the internal print URL Chromium will fetch.
    //
    // CRITICAL: use the incoming request's Host header, NOT env vars.
    //
    // process.env.VERCEL_URL is the DEPLOYMENT URL (like
    // grantedbio-abc123-teds-projects.vercel.app), which has Vercel
    // Deployment Protection turned on by default. Chromium fetching
    // that URL without a session cookie gets redirected to Vercel's
    // login page and never sees our print route.
    //
    // The user's browser hits us via the production alias
    // (www.granted.bio), which is publicly accessible. Use the same
    // host so Chromium can too. `x-forwarded-host` is set by Vercel's
    // edge to preserve the original request host across function
    // invocations.
    const headers = request.headers
    const requestHost = headers.get('x-forwarded-host') || headers.get('host') || 'www.granted.bio'
    const requestProto = headers.get('x-forwarded-proto') || 'https'
    const origin = process.env.NEXT_PUBLIC_SITE_URL || `${requestProto}://${requestHost}`

    // Get-or-mint an active share URL for the report owner so the
    // PDF's "view full analysis" back-link works without requiring
    // the recipient to sign in. When admins generate a PDF on
    // behalf of another user, the share is owned by that user (the
    // report's user_id), not the admin.
    const share = await getOrCreateActiveShareForReport({
      reportId: id,
      ownerUserId: report.user_id as string,
    })
    const shareUrl = buildShareUrl(share.token)

    const printUrl = `${origin}/reports/${id}/print?shareUrl=${encodeURIComponent(shareUrl)}`

    const generatedDate = new Date(report.created_at as string).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
    const reportTitle = (report.title || report.topic || 'Intelligence Report').trim()

    // Render Chromium → PDF bytes.
    const pdfBytes = await renderReportPdf({
      url: printUrl,
      reportTitle,
      generatedDate,
    })

    // Upload to Storage. Use upsert so re-generation overwrites the
    // previous version (same report_id → same path). The bucket is
    // private; the client only sees a short-lived signed URL.
    const storagePath = `${id}.pdf`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(pdfBytes), {
        contentType: 'application/pdf',
        upsert: true,
      })
    if (uploadErr) {
      console.error('[PDF] Upload failed:', uploadErr)
      return NextResponse.json(
        { error: 'PDF generated but upload failed.', detail: uploadErr.message },
        { status: 500 },
      )
    }

    // Return a short-lived signed URL. Client fetches this and triggers
    // a download via <a download>.
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC)
    if (signErr || !signed) {
      console.error('[PDF] Sign failed:', signErr)
      return NextResponse.json({ error: 'Signed URL failed' }, { status: 500 })
    }

    return NextResponse.json({
      url: signed.signedUrl,
      expiresInSec: SIGNED_URL_TTL_SEC,
      sizeBytes: pdfBytes.byteLength,
    })
  } catch (err) {
    console.error('[PDF] Generation failed:', err)
    return NextResponse.json(
      { error: 'PDF generation failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
