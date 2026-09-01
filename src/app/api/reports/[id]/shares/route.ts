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
  getShareViewAnalyticsBatch,
  SHARE_TOKEN_DEFAULT_TTL_DAYS,
} from '@/lib/reports/share-tokens'

interface CreateShareBody {
  recipientEmail?: string | null
  senderMessage?: string | null
  senderDisplayName?: string | null
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
    const analytics = await getShareViewAnalyticsBatch(rows.map((r) => r.id))
    return NextResponse.json({
      shares: rows.map((r) => toShareSummary(r, analytics[r.id])),
    })
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
    const senderDisplayName =
      typeof body.senderDisplayName === 'string' && body.senderDisplayName.trim()
        ? body.senderDisplayName.trim().slice(0, 120)
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
      senderDisplayName,
    })

    // Resolve the display name to use in the email + attribution:
    // prefer the per-share name (just-typed override), fall back to
    // profile lookup, then to "A colleague." Same precedence used by
    // the /share/[token] layout so email + attribution stay in sync.
    const resolvedSenderName =
      senderDisplayName ?? (await lookupSenderName(user.id))

    // Await the email so we can report the outcome back to the
    // client — the dialog needs to know whether to say "sent" vs
    // "link created but email failed, please copy the URL manually."
    // The mint has already succeeded so an email failure never
    // rejects the request; we just surface the reason.
    let emailStatus: { attempted: boolean; sent: boolean; error: string | null } = {
      attempted: false,
      sent: false,
      error: null,
    }
    if (recipientEmail) {
      emailStatus = await sendShareEmail({
        recipientEmail,
        senderName: resolvedSenderName,
        senderMessage,
        reportTitle: report.title,
        reportTopic: report.topic,
        shareUrl: buildShareUrl(row.token),
      })
    }

    return NextResponse.json({
      share: toShareSummary(row),
      ttlDays: SHARE_TOKEN_DEFAULT_TTL_DAYS,
      email: emailStatus,
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

interface EmailResult {
  attempted: boolean
  sent: boolean
  error: string | null
}

async function sendShareEmail(params: ShareEmailParams): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESEND_CONTACT_FORM_API_KEY
  if (!apiKey) {
    console.warn(
      '[shares] Neither RESEND_API_KEY nor RESEND_CONTACT_FORM_API_KEY set; skipping recipient email',
    )
    return {
      attempted: true,
      sent: false,
      error: 'Email delivery is not configured on the server.',
    }
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

  // Loud logging both sides of the call — Resend failures were
  // invisible before because the send was fire-and-forget and the
  // caller had no way to distinguish "sent" from "silently dropped."
  // Prints on every attempt so Vercel logs can be grep'd for
  // "[shares] Resend attempt" to build a full trace.
  console.log(
    `[shares] Resend attempt: to=${params.recipientEmail} from=hello@granted.bio subject="${subject.slice(0, 80)}"`,
  )

  try {
    const { data, error } = await resend.emails.send({
      from: 'granted.bio <hello@granted.bio>',
      to: params.recipientEmail,
      replyTo: 'hello@granted.bio',
      subject,
      text: textLines.join('\n'),
    })
    if (error) {
      const detail = JSON.stringify(error)
      console.error(`[shares] Resend send failed for ${params.recipientEmail}:`, detail)
      return {
        attempted: true,
        sent: false,
        // The Resend error object typically has `name` + `message`.
        // Surface both so the client can render something meaningful.
        error: (error as { message?: string }).message ?? detail,
      }
    }
    const messageId = (data as { id?: string } | null)?.id ?? '(no id)'
    console.log(`[shares] Resend send OK for ${params.recipientEmail}: message_id=${messageId}`)
    return { attempted: true, sent: true, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[shares] Resend threw for ${params.recipientEmail}: ${msg}`)
    return { attempted: true, sent: false, error: msg }
  }
}
