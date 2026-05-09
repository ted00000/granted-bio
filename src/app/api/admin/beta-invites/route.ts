import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401, userId: null }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { error: 'Admin access required', status: 403, userId: null }
  }
  return { error: null, status: 200, userId: user.id }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Pull invites + the corresponding profile (when claimed) so we can show
  // tier and expiry status alongside the invite list.
  const { data: invites, error } = await supabaseAdmin
    .from('beta_invites')
    .select('id, email, invited_at, claimed_at, claimed_by_user_id, notes')
    .order('invited_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to load invites', details: error.message }, { status: 500 })
  }

  // Hydrate claimed-user profiles in a single query
  const userIds = (invites ?? []).map(i => i.claimed_by_user_id).filter((u): u is string => !!u)
  let profiles: Array<{ id: string; tier: string | null; beta_expires_at: string | null }> = []
  if (userIds.length > 0) {
    const res = await supabaseAdmin
      .from('user_profiles')
      .select('id, tier, beta_expires_at')
      .in('id', userIds)
    profiles = res.data ?? []
  }
  const profileMap = new Map(profiles.map(p => [p.id, p]))

  // Report counts per claimed user
  let reportCounts: Record<string, number> = {}
  if (userIds.length > 0) {
    const res = await supabaseAdmin
      .from('user_reports')
      .select('user_id')
      .in('user_id', userIds)
    if (res.data) {
      for (const row of res.data) {
        reportCounts[row.user_id] = (reportCounts[row.user_id] ?? 0) + 1
      }
    }
  }

  const enriched = (invites ?? []).map(inv => {
    const profile = inv.claimed_by_user_id ? profileMap.get(inv.claimed_by_user_id) : undefined
    return {
      ...inv,
      tier: profile?.tier ?? null,
      beta_expires_at: profile?.beta_expires_at ?? null,
      reports_used: inv.claimed_by_user_id ? (reportCounts[inv.claimed_by_user_id] ?? 0) : 0,
    }
  })

  return NextResponse.json({ invites: enriched })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error || !auth.userId) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  // Insert invite (unique by email; conflict → already invited)
  const { error: insertError } = await supabaseAdmin
    .from('beta_invites')
    .insert({
      email,
      invited_by: auth.userId,
      notes,
    })

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'Email already invited' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to add invite', details: insertError.message }, { status: 500 })
  }

  // If a user with this email already exists, claim immediately so they don't
  // need to sign out/in to get promoted.
  const { data: existingUser } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email')
    .eq('email', email)
    .single()

  if (existingUser) {
    await supabaseAdmin.rpc('claim_beta_invite', {
      p_user_id: existingUser.id,
      p_email: email,
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Look up invite to see if it was claimed; if so, also revert the user's tier.
  const { data: invite } = await supabaseAdmin
    .from('beta_invites')
    .select('claimed_by_user_id')
    .eq('id', id)
    .single()

  const { error } = await supabaseAdmin
    .from('beta_invites')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete invite', details: error.message }, { status: 500 })
  }

  // Revert the user to free if their beta tier came from this invite
  if (invite?.claimed_by_user_id) {
    await supabaseAdmin
      .from('user_profiles')
      .update({
        tier: 'free',
        tier_updated_at: new Date().toISOString(),
        beta_claimed_at: null,
        beta_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.claimed_by_user_id)
      .eq('tier', 'beta') // only revert if still beta (don't downgrade an upgraded pro user)
  }

  return NextResponse.json({ success: true })
}
