/**
 * Smoke-test the lint-retry pipeline against the current sample report.
 *
 * Pulls the sample markdown, runs the linter, then runs applyLintCorrections,
 * then re-lints. Prints the before/after critical violation counts.
 * Doesn't mutate the DB.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { lintReport, partitionViolations, formatViolations } = await import(
    '../src/lib/reports/lint-report'
  )
  const { applyLintCorrections } = await import('../src/lib/reports/lint-retry')

  const SAMPLE_REPORT_ID = '9c79d96b-44c0-4783-8d51-90727280a52c'
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('id, topic, markdown_content, funding_stats, agent_outputs')
    .eq('id', SAMPLE_REPORT_ID)
    .single()

  if (error || !data?.markdown_content) {
    console.error('Failed to load sample report:', error)
    process.exit(1)
  }

  const agentOutputs = data.agent_outputs as unknown as Parameters<typeof lintReport>[0]['agentOutputs']
  const fundingStats = data.funding_stats as unknown as Parameters<typeof lintReport>[0]['fundingStats']
  const whiteSpace = ((agentOutputs as unknown as { whiteSpace?: unknown }).whiteSpace ?? {}) as Parameters<typeof lintReport>[0]['whiteSpace']
  const topResearchers = ((agentOutputs as unknown as { topResearchers?: unknown }).topResearchers ?? []) as Parameters<typeof lintReport>[0]['topResearchers']

  const before = lintReport({
    markdown: data.markdown_content,
    agentOutputs,
    fundingStats,
    topResearchers,
    whiteSpace,
  })
  const beforePart = partitionViolations(before)
  console.log(`BEFORE: ${beforePart.critical.length} critical, ${beforePart.warnings.length} warnings`)

  const usageTracker = { inputTokens: 0, outputTokens: 0 }
  const corrected = await applyLintCorrections(
    data.markdown_content,
    before,
    data.topic || 'unknown topic',
    usageTracker,
  )

  const after = lintReport({
    markdown: corrected,
    agentOutputs,
    fundingStats,
    topResearchers,
    whiteSpace,
  })
  const afterPart = partitionViolations(after)
  console.log(`AFTER: ${afterPart.critical.length} critical, ${afterPart.warnings.length} warnings`)
  console.log(`TOKENS: ${usageTracker.inputTokens} input, ${usageTracker.outputTokens} output`)
  console.log(`\n=== Critical violations remaining ===`)
  console.log(formatViolations(afterPart.critical))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
