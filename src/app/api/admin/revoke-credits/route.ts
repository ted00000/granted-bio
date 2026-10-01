// POST /api/admin/revoke-credits
//
// Admin-only. Revokes N unconsumed generation credits from a target
// user, oldest first. Each revoked credit is marked consumed_at=NOW()
// with consumed_for_report_id=null and the admin's identity + reason
// prepended to the notes field. "Revocation" is distinguishable from
// "consumption by report" by the null consumed_for_report_id — the
// ledger stays a complete audit trail of every credit's lifecycle.
//
// Companion to /api/admin/grant-credits. Together they let an admin
// adjust a user's balance in either direction without touching the
// report_credits table directly.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { revokeGenerationCredits } from '@/lib/billing/credits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_REVOKE_PER_CALL = 20

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

interface RevokeBody {
  userId?: string
  count?: number
  note?: string
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as RevokeBody
  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const count = typeof body.count === 'number' ? Math.floor(body.count) : 0
  const note = typeof body.note === 'string' ? body.note.trim() : ''

  if (!targetUserId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (count < 1 || count > MAX_REVOKE_PER_CALL) {
    return NextResponse.json(
      { error: `count must be between 1 and ${MAX_REVOKE_PER_CALL}` },
      { status: 400 },
    )
  }
  if (!note) {
    return NextResponse.json(
      { error: 'note is required (lands in the ledger for audit — e.g., "duplicate grant", "test cleanup")' },
      { status: 400 },
    )
  }

  const { data: targetProfile, error: profileErr } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email')
    .eq('id', targetUserId)
    .single()
  if (profileErr || !targetProfile) {
    return NextResponse.json({ error: 'Target user not found' }, { status: 404 })
  }

  const { revoked } = await revokeGenerationCredits({
    userId: targetUserId,
    count,
    adminId: auth.adminId!,
    reason: note,
  })

  console.log(
    `[admin revoke-credits] admin=${auth.adminId} revoked=${revoked} (requested=${count}) from user=${targetUserId} (${targetProfile.email}). Reason="${note}".`,
  )

  return NextResponse.json({
    revoked,
    requested: count,
    targetEmail: targetProfile.email,
  })
}
