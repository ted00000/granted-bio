/**
 * Smoke-test the report linter against the current sample report.
 *
 * Pulls the sample report row from Supabase, runs the linter against
 * its markdown + reconstructed context, and prints violations. Doesn't
 * mutate anything. Useful to gut-check the linter against a real
 * generated report before wiring it into production.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { lintReport, formatViolations, partitionViolations } = await import(
    '../src/lib/reports/lint-report'
  )

  const SAMPLE_REPORT_ID = '9c79d96b-44c0-4783-8d51-90727280a52c'
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('id, markdown_content, funding_stats, agent_outputs')
    .eq('id', SAMPLE_REPORT_ID)
    .single()

  if (error || !data) {
    console.error('Failed to load sample report:', error)
    process.exit(1)
  }
  if (!data.markdown_content) {
    console.error('Sample report has no markdown_content')
    process.exit(1)
  }

  const agentOutputs = data.agent_outputs as unknown as Parameters<typeof lintReport>[0]['agentOutputs']
  const fundingStats = data.funding_stats as unknown as Parameters<typeof lintReport>[0]['fundingStats']
  const whiteSpace = (agentOutputs as unknown as { whiteSpace?: unknown }).whiteSpace as
    | Parameters<typeof lintReport>[0]['whiteSpace']
    | undefined

  if (!whiteSpace) {
    console.error('Sample report has no whiteSpace in agent_outputs — cannot lint White Space rules')
    process.exit(1)
  }

  // topResearchers isn't stored on user_reports directly — reconstruct
  // an approximation from the aggregate stored on agent_outputs if
  // available. If not, empty array (the PI-name rule will pass trivially).
  const topResearchers =
    ((agentOutputs as unknown as { topResearchers?: unknown }).topResearchers as
      | Parameters<typeof lintReport>[0]['topResearchers']
      | undefined) || []

  const violations = lintReport({
    markdown: data.markdown_content,
    agentOutputs,
    fundingStats,
    topResearchers,
    whiteSpace,
  })

  console.log(formatViolations(violations))
  const { critical, warnings } = partitionViolations(violations)
  console.log(`\nSummary: ${critical.length} critical, ${warnings.length} warning(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
