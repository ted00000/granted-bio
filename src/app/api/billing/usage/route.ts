// Get user's current billing usage

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserUsage, getMonthlyApiUsage } from '@/lib/billing/usage'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's role
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role || 'user'
    const usage = await getUserUsage(user.id)

    // Also get report purchase history
    const { data: purchases } = await supabaseAdmin
      .from('report_purchases')
      .select('id, topic, persona, status, created_at, completed_at, report_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    // For associates, also get their API usage
    let apiUsage = null
    if (role === 'associate') {
      apiUsage = await getMonthlyApiUsage(user.id)
    }

    // Flatten structure for account page
    // Handle Infinity (for admin/associate) - JSON can't serialize Infinity
    const isUnlimited = !Number.isFinite(usage.searches.limit)
    return NextResponse.json({
      role,
      tier: usage.tier,
      searchesUsed: usage.searches.used,
      searchLimit: isUnlimited ? 999999 : usage.searches.limit,
      isUnlimited,
      subscriptionStatus: usage.subscriptionStatus,
      currentPeriodEnd: usage.currentPeriodEnd,
      reportPurchases: purchases || [],
      apiUsage, // null for non-associates
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Billing Usage] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
