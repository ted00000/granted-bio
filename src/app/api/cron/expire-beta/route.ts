import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Daily sweep that demotes expired beta users to the free tier.
 * Called by Vercel cron (configured in vercel.json) once per day.
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * The matching CRON_SECRET env var is set in the Vercel project settings.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    console.error('[cron/expire-beta] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Sweep all expired beta users
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .update({
      tier: 'free',
      tier_updated_at: new Date().toISOString(),
      beta_claimed_at: null,
      beta_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tier', 'beta')
    .lt('beta_expires_at', new Date().toISOString())
    .select('id, email')

  if (error) {
    console.error('[cron/expire-beta] sweep failed:', error)
    return NextResponse.json(
      { error: 'Sweep failed', details: error.message },
      { status: 500 }
    )
  }

  const reverted = data?.length ?? 0
  console.log(`[cron/expire-beta] reverted ${reverted} expired beta user(s) to free`)
  return NextResponse.json({
    reverted,
    user_ids: (data ?? []).map((u) => u.id),
  })
}
