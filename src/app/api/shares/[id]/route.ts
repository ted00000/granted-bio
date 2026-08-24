// DELETE /api/shares/[id]
//
// Soft-revoke a share. Ownership is verified before the write. Uses
// the anon-authed client to read the row (RLS enforces owner-only
// SELECT), then routes the update through the service-role helper so
// the WITH CHECK on the "Owners revoke own shares" policy can't be
// bypassed if we ever tighten it further.
//
// The name is "DELETE" but the effect is UPDATE — we keep the row so
// the buyer can still audit which shares existed and see revoked
// state in the manage-shares list. See migration comment for the
// rationale.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { revokeShare } from '@/lib/reports/share-tokens'

export async function DELETE(
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

    // Ownership check — reading with the anon-authed client trips
    // RLS if the row isn't owned by the caller. maybeSingle so we
    // return 404 without a JS throw.
    const { data: share } = await supabase
      .from('analysis_shares')
      .select('id, owner_user_id, revoked_at')
      .eq('id', id)
      .maybeSingle()
    if (!share || share.owner_user_id !== user.id) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 })
    }
    if (share.revoked_at) {
      // Already revoked — succeed idempotently so the client doesn't
      // have to distinguish "already gone" from "just killed it."
      return NextResponse.json({ ok: true, alreadyRevoked: true })
    }

    await revokeShare(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[shares DELETE] error:', e)
    return NextResponse.json({ error: 'Failed to revoke share' }, { status: 500 })
  }
}
