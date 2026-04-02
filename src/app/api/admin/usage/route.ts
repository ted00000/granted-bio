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

    // Get optional filters
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const period = searchParams.get('period') || 'month' // 'month', 'all'
    const format = searchParams.get('format') || 'json' // 'json', 'csv'

    // Build date filter
    let dateFilter: string | null = null
    let periodLabel = 'All Time'
    if (period === 'month') {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      dateFilter = startOfMonth.toISOString()
      periodLabel = startOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    }

    // Query usage data with user info for CSV
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

    const { data: usage, error } = await query.limit(10000)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get user profiles for email lookup
    const userIds = [...new Set((usage || []).map(u => u.user_id))]
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, full_name, role')
      .in('id', userIds)

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || [])

    // Aggregate by user
    const userTotals: Record<string, {
      userId: string
      email: string
      name: string
      role: string
      totalCostCents: number
      totalInputTokens: number
      totalOutputTokens: number
      callCount: number
    }> = {}

    for (const row of usage || []) {
      if (!userTotals[row.user_id]) {
        const profile = profileMap.get(row.user_id)
        userTotals[row.user_id] = {
          userId: row.user_id,
          email: profile?.email || 'Unknown',
          name: profile?.full_name || '',
          role: profile?.role || 'user',
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

    // CSV export
    if (format === 'csv') {
      const totals = Object.values(userTotals)

      // Build CSV content
      const csvRows: string[] = []

      // Header
      csvRows.push('Email,Name,Role,API Calls,Input Tokens,Output Tokens,Cost ($)')

      // Data rows
      for (const total of totals) {
        const costDollars = (total.totalCostCents / 100).toFixed(2)
        csvRows.push([
          `"${total.email}"`,
          `"${total.name}"`,
          total.role,
          total.callCount,
          total.totalInputTokens,
          total.totalOutputTokens,
          costDollars,
        ].join(','))
      }

      // Summary row
      const grandTotal = totals.reduce((acc, t) => ({
        calls: acc.calls + t.callCount,
        input: acc.input + t.totalInputTokens,
        output: acc.output + t.totalOutputTokens,
        cost: acc.cost + t.totalCostCents,
      }), { calls: 0, input: 0, output: 0, cost: 0 })

      csvRows.push('')
      csvRows.push(`"TOTAL","","",${ grandTotal.calls},${grandTotal.input},${grandTotal.output},${(grandTotal.cost / 100).toFixed(2)}`)

      const csv = csvRows.join('\n')
      const filename = `api-usage-${period}-${new Date().toISOString().split('T')[0]}.csv`

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    return new Response(JSON.stringify({
      usage: usage || [],
      totals: Object.values(userTotals),
      period,
      periodLabel,
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
