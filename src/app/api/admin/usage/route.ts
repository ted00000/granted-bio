import { NextRequest } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    // Verify admin role
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check if user is admin
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get optional user_id filter
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const period = searchParams.get('period') || 'month' // 'month', 'all'

    // Build date filter
    let dateFilter: string | null = null
    if (period === 'month') {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      dateFilter = startOfMonth.toISOString()
    }

    // Query usage data
    let query = supabaseAdmin
      .from('api_usage')
      .select(`
        id,
        user_id,
        created_at,
        endpoint,
        persona,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        cost_cents
      `)
      .order('created_at', { ascending: false })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    if (dateFilter) {
      query = query.gte('created_at', dateFilter)
    }

    const { data: usage, error } = await query.limit(1000)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Aggregate by user
    const userTotals: Record<string, {
      userId: string
      totalCostCents: number
      totalInputTokens: number
      totalOutputTokens: number
      callCount: number
    }> = {}

    for (const row of usage || []) {
      if (!userTotals[row.user_id]) {
        userTotals[row.user_id] = {
          userId: row.user_id,
          totalCostCents: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          callCount: 0,
        }
      }
      userTotals[row.user_id].totalCostCents += Number(row.cost_cents)
      userTotals[row.user_id].totalInputTokens += row.input_tokens
      userTotals[row.user_id].totalOutputTokens += row.output_tokens
      userTotals[row.user_id].callCount += 1
    }

    return new Response(JSON.stringify({
      usage: usage || [],
      totals: Object.values(userTotals),
      period,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Admin usage API error:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch usage' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
