// Quick test script for report agents
// Run with: npx tsx scripts/test-report-agents.ts

// Load env BEFORE any other imports
import { config } from 'dotenv'
config({ path: '.env.local' })

const TOPIC = 'CAR-T cell therapy'

async function testAgents() {
  // Dynamic imports after env is loaded
  const { runProjectsAgent } = await import('../src/lib/reports/agents/projects')
  const { runTrialsAgent } = await import('../src/lib/reports/agents/trials')
  const { runPatentsAgent } = await import('../src/lib/reports/agents/patents')
  const { runPublicationsAgent } = await import('../src/lib/reports/agents/publications')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Testing report agents for: "${TOPIC}"`)
  console.log(`${'='.repeat(60)}\n`)

  // Test Projects Agent
  console.log('📊 PROJECTS AGENT')
  console.log('-'.repeat(40))
  try {
    const projects = await runProjectsAgent(TOPIC)
    console.log(`  Total projects: ${projects.items.length}`)
    console.log(`  Total funding: $${(projects.totalFunding / 1e6).toFixed(1)}M`)
    console.log(`  By year:`, projects.byYear.slice(0, 3).map(y => `${y.year}: ${y.projects}`).join(', '))
    console.log(`  Top orgs:`, projects.byOrg.slice(0, 3).map(o => o.org).join(', '))
    console.log(`  Sample titles:`)
    projects.items.slice(0, 3).forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.title?.substring(0, 60)}...`)
    })
  } catch (error) {
    console.error('  ERROR:', error)
  }

  console.log()

  // Test Trials Agent
  console.log('🏥 TRIALS AGENT')
  console.log('-'.repeat(40))
  try {
    const trials = await runTrialsAgent(TOPIC)
    console.log(`  Total trials: ${trials.items.length}`)
    console.log(`  By phase:`, Object.entries(trials.byPhase).map(([p, c]) => `${p}: ${c}`).join(', '))
    console.log(`  Sample titles:`)
    trials.items.slice(0, 5).forEach((t, i) => {
      console.log(`    ${i + 1}. [${t.nct_id}] ${t.study_title?.substring(0, 50)}...`)
    })
  } catch (error) {
    console.error('  ERROR:', error)
  }

  console.log()

  // Test Patents Agent
  console.log('📜 PATENTS AGENT')
  console.log('-'.repeat(40))
  try {
    const patents = await runPatentsAgent(TOPIC)
    console.log(`  Total patents: ${patents.items.length}`)
    console.log(`  Recent (2yr): ${patents.recentCount}`)
    console.log(`  Top assignees:`, patents.byAssignee.slice(0, 3).map(a => a.assignee).join(', ') || 'None')
    console.log(`  Sample titles:`)
    patents.items.slice(0, 5).forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.patent_title?.substring(0, 60) || 'Untitled'}...`)
    })
  } catch (error) {
    console.error('  ERROR:', error)
  }

  console.log()

  // Test Publications Agent
  console.log('📚 PUBLICATIONS AGENT')
  console.log('-'.repeat(40))
  try {
    const pubs = await runPublicationsAgent(TOPIC)
    console.log(`  Total publications: ${pubs.items.length}`)
    console.log(`  Top journals:`, pubs.byJournal.slice(0, 3).map(j => j.journal).join(', ') || 'None')
    console.log(`  Sample titles:`)
    pubs.items.slice(0, 5).forEach((p, i) => {
      console.log(`    ${i + 1}. ${p.publication_title?.substring(0, 60) || 'Untitled'}...`)
    })
  } catch (error) {
    console.error('  ERROR:', error)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('Test complete')
  console.log(`${'='.repeat(60)}\n`)
}

testAgents().catch(console.error)
