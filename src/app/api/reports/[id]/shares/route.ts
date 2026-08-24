// Analysis-share API for a specific report:
//   * GET    → list the owner's shares for this report
//   * POST   → mint a new share (optionally emails the recipient)
//
// Both routes verify ownership up front. Share creation + listing
// then run through service-role helpers in share-tokens.ts so RLS
// stays intact for anyone else.

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createShare,
  listSharesForReport,
  toShareSummary,
  buildShareUrl,
  SHARE_TOKEN_DEFAULT_TTL_DAYS,
} from '@/lib/reports/share-tokens'

interface CreateShareBody {
  recipientEmail?: string | null
  senderMessage?: string | null
}

function isValidEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

/**
 * GET /api/reports/[id]/shares — list all shares this owner has
 * created for `id`. Returns [] when the report has no shares yet.
 * 401 if unauthenticated, 404 if the report isn't owned by the caller.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ownership check — cheap SELECT that trips RLS if the caller
    // doesn't own the row. Returning 404 (not 403) matches the pattern
    // used by /api/reports/[id]/route.ts and avoids leaking existence.
    const { data: report, error } = await supabase
      .from('user_reports')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (error || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const rows = await listSharesForReport({ reportId: id, ownerUserId: user.id })
    return NextResponse.json({ shares: rows.map(toShareSummary) })
  } catch (e) {
    console.error('[shares GET] error:', e)
    return NextResponse.json({ error: 'Failed to list shares' }, { status: 500 })
  }
}

/**
 * POST /api/reports/[id]/shares — mint a new share for this report.
 * Body: { recipientEmail?, senderMessage? } — both optional. When
 * recipientEmail is present, we also send the recipient an email
 * with the share URL via Resend (fire-and-forget; the API returns
 * success even if the email fails, since the token is minted either
 * way and the owner can copy the link manually).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => ({}))) as CreateShareBody

    const recipientEmail =
      typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
        ? body.recipientEmail.trim().toLowerCase()
        : null
    const senderMessage =
      typeof body.senderMessage === 'string' && body.senderMessage.trim()
        ? body.senderMessage.trim().slice(0, 2000) // hard cap to avoid abuse
        : null

    if (recipientEmail && !isValidEmail(recipientEmail)) {
      return NextResponse.json(
        { error: 'Recipient email is not a valid address.' },
        { status: 400 }
      )
    }

    // Ownership + shareability check. Only completed reports can be
    // shared (an in-progress or failed report doesn't have a rendered
    // portal to show). Pull title + topic here so we can use them in
    // the recipient email without a second round-trip.
    const { data: report, error } = await supabase
      .from('user_reports')
      .select('id, title, topic, status, report_type')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (error || !report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    if (report.status !== 'complete') {
      return NextResponse.json(
        { error: 'Only completed analyses can be shared.' },
        { status: 400 }
      )
    }

    const row = await createShare({
      reportId: id,
      ownerUserId: user.id,
      recipientEmail,
      senderMessage,
    })

    // Fire-and-forget email — the mint has already succeeded, so
    // failures here don't reject the request. Owner gets the URL
    // in the response and can send it manually if the email fails.
    if (recipientEmail) {
      void sendShareEmail({
        recipientEmail,
        senderName: await lookupSenderName(user.id),
        senderMessage,
        reportTitle: report.title,
        reportTopic: report.topic,
        shareUrl: buildShareUrl(row.token),
      })
    }

    return NextResponse.json({
      share: toShareSummary(row),
      ttlDays: SHARE_TOKEN_DEFAULT_TTL_DAYS,
    })
  } catch (e) {
    console.error('[shares POST] error:', e)
    return NextResponse.json({ error: 'Failed to create share' }, { status: 500 })
  }
}

/**
 * Look up the sender's display name from their profile so the
 * recipient email can say "Alice Chen shared..." instead of
 * "Someone shared..." Fallback to "A colleague" when the profile
 * hasn't captured a name yet (rare — /chat gates on it).
 */
async function lookupSenderName(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('id', userId)
    .maybeSingle()
  const first = (data?.first_name as string | null | undefined)?.trim()
  const last = (data?.last_name as string | null | undefined)?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  return 'A colleague'
}

interface ShareEmailParams {
  recipientEmail: string
  senderName: string
  senderMessage: string | null
  reportTitle: string
  reportTopic: string | null
  shareUrl: string
}

async function sendShareEmail(params: ShareEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESEND_CONTACT_FORM_API_KEY
  if (!apiKey) {
    console.log('[shares] RESEND_API_KEY not set; skipping recipient email')
    return
  }

  const resend = new Resend(apiKey)
  const topicLabel = params.reportTopic ?? params.reportTitle
  const subject = `${params.senderName} shared an analysis with you: ${topicLabel}`

  // Keep the plain-text version deliberately conversational — this
  // reads like a person forwarded a link, not like a transactional
  // notification. The recipient hasn't opted into granted.bio; if it
  // feels like marketing they'll bounce.
  const textLines = [
    `${params.senderName} shared a granted.bio intelligence analysis with you.`,
    '',
    `Topic: ${topicLabel}`,
    '',
    params.senderMessage ? `Message from ${params.senderName}:` : null,
    params.senderMessage ? `"${params.senderMessage}"` : null,
    params.senderMessage ? '' : null,
    `View the analysis: ${params.shareUrl}`,
    '',
    'The link works for 60 days and no account is required to view it.',
  ].filter((line): line is string => line !== null)

  try {
    const { error } = await resend.emails.send({
      from: 'granted.bio <hello@granted.bio>',
      to: params.recipientEmail,
      replyTo: 'hello@granted.bio',
      subject,
      text: textLines.join('\n'),
    })
    if (error) {
      console.error('[shares] Resend send failed:', error)
    }
  } catch (e) {
    console.error('[shares] Resend threw:', e)
  }
}
