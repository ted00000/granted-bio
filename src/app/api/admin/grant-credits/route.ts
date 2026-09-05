// POST /api/admin/grant-credits
//
// Admin-only endpoint that mints `count` generation credits for a
// target user, sourced as 'admin_grant' with a required note field
// for audit. Complements Stripe promotion codes: promo codes are
// self-serve at checkout; this is the fully off-Stripe path for
// one-off comps, press seeds, beta rewards, and hand-picked BD gifts.
//
// Design decisions:
//   * generation credits only. Refresh/retry credits are auto-granted
//     alongside generation via the existing purchase flow; admins
//     wanting to grant a refresh do it by granting a generation
//     credit and letting the user consume it (which mints a refresh
//     bound to the new report).
//   * `notes` is required. Comp reasons ("press: TechCrunch briefing",
//     "beta reward: cell-free-group review") land in the ledger so we
//     can reconcile spend later. Empty notes are rejected.
//   * expires_at defaults to 12 months from grant — same window as
//     purchase-granted credits so downstream expiry logic doesn't
//     need to special-case admin grants.
//   * One row per credit (not a single row with a count). Keeps the
//     ledger's one-consume-per-row invariant intact and lets the
//     existing consumption path work without changes.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_CREDITS_PER_GRANT = 20
const CREDIT_TTL_MONTHS = 12

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const, adminId: null }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { error: 'Admin access required', status: 403 as const, adminId: null }
  }
  return { error: null, status: 200 as const, adminId: user.id }
}

interface GrantCreditsBody {
  userId?: string
  count?: number
  note?: string
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as GrantCreditsBody

  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const count = typeof body.count === 'number' ? Math.floor(body.count) : 0
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  if (!targetUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (count < 1 || count > MAX_CREDITS_PER_GRANT) {
    return NextResponse.json(
      { error: `count must be between 1 and ${MAX_CREDITS_PER_GRANT}` },
      { status: 400 },
    )
  }
  if (!note) {
    return NextResponse.json(
      { error: 'note is required (used for ledger audit — e.g., "press: TechCrunch briefing")' },
      { status: 400 },
    )
  }

  // Verify target user exists — otherwise the FK insert would 500
  // with an opaque message.
  const { data: targetProfile, error: profileErr } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email')
    .eq('id', targetUserId)
    .single()
  if (profileErr || !targetProfile) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  }

  const now = new Date()
  const expiresAt = new Date(now)
  expiresAt.setMonth(expiresAt.getMonth() + CREDIT_TTL_MONTHS)

  // Namespace the note with the granting admin id so an audit reader
  // can see who issued what without joining another table.
  const ledgerNote = `[admin_grant by ${auth.adminId}] ${note}`

  // One row per credit — matches the ledger's per-row consumption
  // invariant. Bulk insert so it's a single round-trip.
  const rows = Array.from({ length: count }, () => ({
    user_id: targetUserId,
    credit_type: 'generation' as const,
    source: 'admin_grant' as const,
    granted_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    notes: ledgerNote,
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('report_credits')
    .insert(rows)
    .select('id')

  if (insertErr) {
    console.error('[admin grant-credits] insert failed:', insertErr)
    return NextResponse.json(
      { error: 'Failed to insert credits', detail: insertErr.message },
      { status: 500 },
    )
  }

  // Refresh the target's 3-month platform pass alongside the credits.
  // A comp'd analysis should carry the full paid experience — Pro-
  // tier search, drill-down, refresh/retry — not just the credit
  // and then a downgraded platform. Same reset model as a paid
  // purchase: NOW() + 90 days regardless of current value.
  const passExpiresAt = new Date()
  passExpiresAt.setDate(passExpiresAt.getDate() + 90)
  const { error: passErr } = await supabaseAdmin
    .from('user_profiles')
    .update({ platform_pass_expires_at: passExpiresAt.toISOString() })
    .eq('id', targetUserId)
  if (passErr) {
    // Log-and-continue — the credit grant already succeeded, so
    // failing to bump the pass shouldn't roll it back.
    console.error(
      `[admin grant-credits] failed to refresh platform pass for user ${targetUserId}:`,
      passErr.message,
    )
  }

  console.log(
    `[admin grant-credits] admin=${auth.adminId} granted count=${count} to user=${targetUserId} (${targetProfile.email}). Note="${note}". IDs: ${inserted?.map((r) => r.id).join(',')}. Pass reset to ${passExpiresAt.toISOString()}.`,
  )

  return NextResponse.json({
    granted: inserted?.length ?? 0,
    creditIds: inserted?.map((r) => r.id) ?? [],
    targetEmail: targetProfile.email,
    passExpiresAt: passExpiresAt.toISOString(),
  })
}
