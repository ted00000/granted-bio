/**
 * White Space Step 2 classifier verification. Runs the new Haiku
 * classifier against a saved report's sample and prints:
 *
 *   - Per-dimension classification rate under the OLD deterministic
 *     keyword-matcher (baseline).
 *   - Per-dimension classification rate under the NEW Haiku classifier.
 *   - Category-by-category count deltas.
 *   - Total Haiku wall-time and any cache-hit metrics returned.
 *
 * This is NOT a full report generation. It exercises just the Step 2
 * pass in isolation against real data from a persisted report, so we
 * can see the coverage lift without paying for a full synthesis.
 *
 * Usage:  npx tsx scripts/verify-whitespace-classifier.ts <report_id>
 * Default report_id if omitted: the 2026-09-21 radioligand-prostate
 * report used in the audit that motivated the ship.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import type { ProjectItem, WhiteSpaceAnalysis } from '../src/lib/reports/types'

const REPORT_ID = process.argv[2] ?? '7359b4bb-570d-4f7f-9ee2-cb666e85d24e'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

async function main() {
  console.log(`\n=== Fetching report ${REPORT_ID} ===`)
  const { data, error } = await sb
    .from('user_reports')
    .select('id, topic, all_projects, agent_outputs')
    .eq('id', REPORT_ID)
    .single()

  if (error || !data) {
    console.error('Failed to load report:', error)
    process.exit(1)
  }

  const projects = (data.all_projects ?? []) as ProjectItem[]
  const priorWhiteSpace = ((data.agent_outputs ?? {}) as { whiteSpace?: WhiteSpaceAnalysis }).whiteSpace
  if (!priorWhiteSpace || !priorWhiteSpace.dimensions?.length) {
    console.error('Report has no persisted whiteSpace analysis — cannot use its dimensions.')
    process.exit(1)
  }

  console.log(`topic:            ${data.topic}`)
  console.log(`projects sampled: ${projects.length}`)
  console.log(`dimensions:       ${priorWhiteSpace.dimensions.length}`)

  console.log(`\n=== Baseline (deterministic keyword matcher) ===`)
  // Baseline = what the persisted whiteSpace already shows. Print each
  // dimension's totalMatched / total for comparison.
  for (const dim of priorWhiteSpace.dimensions) {
    const total = dim.totalMatched + dim.totalUnclassified
    const rate = total > 0 ? ((dim.totalMatched / total) * 100).toFixed(1) : '0.0'
    console.log(
      `  ${dim.name}: ${dim.totalMatched}/${total} matched (${rate}%)`,
    )
  }

  console.log(`\n=== Running Haiku classifier (Step 2 replacement) ===`)
  // Dynamically import the white-space module so its top-level imports
  // (Anthropic SDK, supabase-admin, etc.) don't fire until we actually
  // need them. Cast to unknown → any-ish because we're reaching into a
  // module that intentionally doesn't export its internals; this is a
  // verification script, not a public API contract.
  const ws = (await import('../src/lib/reports/white-space')) as unknown as {
    // These are internals — we deliberately import via a runtime side
    // door because the module doesn't export them for public use.
  }

  // The classifier isn't exported. Simpler: run the full
  // generateWhiteSpaceAnalysis path but only look at the Step-2 output.
  // For that we need to intercept the Step 2 call. Since we can't
  // monkey-patch easily, run the full analysis and read the resulting
  // dimensions' totalMatched — that reflects the new Step 2 output.
  const wsModule = ws as unknown as {
    generateWhiteSpaceAnalysis?: (
      topic: string,
      projects: ProjectItem[],
      usageTracker: { inputTokens: number; outputTokens: number },
      persona?: 'researcher' | 'investor',
      expandedKeywordQuery?: string,
    ) => Promise<WhiteSpaceAnalysis>
  }
  if (!wsModule.generateWhiteSpaceAnalysis) {
    console.error('generateWhiteSpaceAnalysis is not exported.')
    process.exit(1)
  }

  const usage = { inputTokens: 0, outputTokens: 0 }
  const started = Date.now()
  const analysis = await wsModule.generateWhiteSpaceAnalysis(
    data.topic ?? '',
    projects,
    usage,
    'researcher',
  )
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  console.log(`\n=== Haiku classifier results ===`)
  console.log(`Total wall-time (full whitespace analysis): ${elapsed}s`)
  console.log(`Usage this run: ${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output tokens`)
  console.log()

  // Per-dimension coverage comparison
  for (const dim of analysis.dimensions) {
    const total = dim.totalMatched + dim.totalUnclassified
    const rate = total > 0 ? ((dim.totalMatched / total) * 100).toFixed(1) : '0.0'
    // Find the matching baseline dimension by name.
    const baseline = priorWhiteSpace.dimensions.find((b) => b.name === dim.name)
    const baseTotal = baseline ? baseline.totalMatched + baseline.totalUnclassified : 0
    const baseRate = baseline && baseTotal > 0
      ? ((baseline.totalMatched / baseTotal) * 100).toFixed(1)
      : 'n/a'
    console.log(`  ${dim.name}`)
    console.log(`    baseline: ${baseline?.totalMatched ?? 0}/${baseTotal} matched (${baseRate}%)`)
    console.log(`    haiku:    ${dim.totalMatched}/${total} matched (${rate}%)`)
    // Per-category deltas
    console.log(`    top categories (haiku):`)
    for (const cat of dim.categories.slice(0, 5)) {
      const baseCat = baseline?.categories.find((c) => c.name === cat.name)
      const baseN = baseCat?.projectCount ?? 0
      const delta = cat.projectCount - baseN
      const marker = delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '='
      console.log(`      ${cat.name}: ${cat.projectCount} (baseline ${baseN}) ${marker}`)
    }
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
