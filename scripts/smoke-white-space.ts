/**
 * Smoke test: run generateWhiteSpaceAnalysis against the actual
 * project list from the current sample report. Prints the resulting
 * WhiteSpaceAnalysis to stdout so we can verify shape + numbers before
 * spending real money on a full report regen.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import type { ProjectItem } from '../src/lib/reports/types'

async function main() {
  // Dynamic import so dotenv.config() runs before supabaseAdmin's
  // module-level createClient tries to read env vars.
  const { generateWhiteSpaceAnalysis } = await import('../src/lib/reports/white-space')

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
  const { data: rep } = await sb
    .from('user_reports')
    .select('id, topic, agent_outputs')
    .eq('id', '9700ad61-2c25-4900-9482-22eb550022cb')
    .single()
  if (!rep) {
    console.error('report not found')
    return
  }

  // Pull the real analyzed project list from the report's stored agent_outputs
  const projects = ((rep.agent_outputs as { projects?: { items?: ProjectItem[] } })?.projects
    ?.items || []) as ProjectItem[]

  console.log(`Topic: ${rep.topic}`)
  console.log(`Projects in analyzed set: ${projects.length}`)
  console.log()
  console.log('=== running analyzer ===')

  const t0 = Date.now()
  const tracker = { inputTokens: 0, outputTokens: 0 }
  const analysis = await generateWhiteSpaceAnalysis(rep.topic!, projects, tracker)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`Analyzer completed in ${elapsed}s`)
  console.log(`Tokens: ${tracker.inputTokens} in / ${tracker.outputTokens} out`)
  console.log()

  console.log('OVERVIEW:')
  console.log(analysis.overview)
  console.log()

  console.log('DIMENSIONS:')
  for (const dim of analysis.dimensions) {
    console.log(`  ${dim.name} — ${dim.description}`)
    console.log(`    matched=${dim.totalMatched} unclassified=${dim.totalUnclassified}`)
    for (const cat of dim.categories) {
      const bn = cat.broaderNihCount === -1 ? 'n/a' : cat.broaderNihCount.toLocaleString()
      console.log(
        `      ${cat.name.padEnd(30)} sample=${String(cat.projectCount).padStart(3)}  funding=$${(cat.fundingTotal / 1_000_000).toFixed(1).padStart(6)}M  broader=${bn.padStart(7)}`,
      )
    }
    if (dim.narrative) console.log(`    NARRATIVE: ${dim.narrative}`)
    console.log()
  }

  console.log('TOP OPPORTUNITIES:')
  analysis.topOpportunities.forEach((op, i) => {
    console.log(
      `  ${i + 1}. ${op.categoryName} (${op.dimensionName}) — sample=${op.sampleCount} broader=${op.broaderNihCount} signal=${op.gapSignal}`,
    )
    if (op.rationale) console.log(`     ${op.rationale}`)
  })

  console.log()
  console.log('Scope note:')
  console.log(`  ${analysis.scopeNote}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
