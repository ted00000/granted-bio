// One-off backfill: re-run the market agent against a single report's
// topic to pick up the new structured marketSizing field (added
// 2026-08-23). Merges ONLY the sizing prose + structured object into
// the existing market_context row — the analysis-enhanced `overview`
// and all other narrative fields stay untouched.
import { config } from 'dotenv'
config({ path: '.env.local' })

interface MarketContextRow {
  overview?: string
  marketSize?: string | null
  marketSizing?: unknown
  keyPlayers?: string[]
  recentDevelopments?: string[]
  competitiveLandscape?: string
  sources?: string[]
}

async function main() {
  const REPORT_ID = process.argv[2] || 'a4dbfb7b-2343-46a4-8763-35b1f16d8e58'
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { runMarketAgent } = await import('../src/lib/reports/agents/market')

  console.log(`Refreshing marketSizing on report ${REPORT_ID}`)

  const { data: report, error } = await supabaseAdmin
    .from('user_reports')
    .select('id, topic, market_context')
    .eq('id', REPORT_ID)
    .single()

  if (error || !report) {
    console.error('Report not found:', error?.message ?? 'no row')
    process.exit(1)
  }

  console.log(`Topic: "${report.topic}"`)

  const existing = (report.market_context ?? {}) as MarketContextRow
  console.log(`Existing marketSize prose: ${existing.marketSize ? '(present)' : '(null)'}`)
  console.log(`Existing marketSizing struct: ${existing.marketSizing ? '(present)' : '(missing)'}`)

  console.log('\nRunning market agent... (~10-30s, web search + Claude call)')
  const agentOut = await runMarketAgent(report.topic!)
  const fresh = agentOut.context

  console.log(`Fresh marketSize: ${fresh.marketSize ? '(present)' : '(null)'}`)
  console.log(`Fresh marketSizing scenarios: ${fresh.marketSizing?.scenarios.length ?? 0}`)
  if (fresh.marketSizing) {
    fresh.marketSizing.scenarios.forEach((s) => {
      console.log(`  • ${s.label}: $${s.startValue}B (${s.startYear}) → $${s.endValue}B (${s.endYear}) @ ${s.cagr}% CAGR`)
    })
    if (fresh.marketSizing.firmRange) {
      const r = fresh.marketSizing.firmRange
      console.log(`  Firm range (${r.year}): $${r.min}B – $${r.max}B`)
    }
  }

  if (!fresh.marketSizing) {
    console.log('\nMarket agent did not produce a structured marketSizing — leaving report unchanged.')
    return
  }

  // Merge: keep the enhanced overview + all other narrative fields;
  // only refresh marketSize + marketSizing so prose and structured
  // data stay consistent.
  const merged: MarketContextRow = {
    ...existing,
    marketSize: fresh.marketSize ?? existing.marketSize ?? null,
    marketSizing: fresh.marketSizing,
  }

  const { error: updateError } = await supabaseAdmin
    .from('user_reports')
    .update({ market_context: merged, updated_at: new Date().toISOString() })
    .eq('id', REPORT_ID)

  if (updateError) {
    console.error('DB update failed:', updateError.message)
    process.exit(1)
  }

  console.log('\n✓ Report updated. Reload the Market Context page to see structured tiles.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
