// Get user's current billing usage

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserUsage } from '@/lib/billing/usage'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const usage = await getUserUsage(user.id)

    // Also get report purchase history
    const { data: purchases } = await supabaseAdmin
      .from('report_purchases')
      .select('id, topic, persona, status, created_at, completed_at, report_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    // Flatten structure for account page
    return NextResponse.json({
      tier: usage.tier,
      searchesUsed: usage.searches.used,
      searchLimit: usage.searches.limit,
      subscriptionStatus: usage.subscriptionStatus,
      currentPeriodEnd: usage.currentPeriodEnd,
      reportPurchases: purchases || [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[Billing Usage] Error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
