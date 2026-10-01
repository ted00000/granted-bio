// GET /api/admin/credit-balances
//
// Returns a map { userId: availableCredits } for every userId passed
// via the `userIds` query param (comma-separated) OR, when no param is
// given, every user_profiles row. Used by the admin users table to
// render the per-user credit balance alongside role and API usage.
//
// Admin-only. Credits counted are unconsumed, unexpired generation
// credits — the same definition the generation flow uses when deciding
// whether a user can bypass Stripe.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { countAvailableGenerationCreditsForUsers } from '@/lib/billing/credits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Admin access required', status: 403 as const }
  }
  return { error: null, status: 200 as const }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const userIdsParam = url.searchParams.get('userIds')
  let userIds: string[]
  if (userIdsParam) {
    userIds = userIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  } else {
    const { data } = await supabaseAdmin.from('user_profiles').select('id')
    userIds = (data ?? []).map((r) => (r as { id: string }).id)
  }

  const balances = await countAvailableGenerationCreditsForUsers(userIds)
  return NextResponse.json({ balances })
}
