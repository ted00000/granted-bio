/**
 * Generate a test report and output to file
 * Run with: npx tsx scripts/generate-test-report.ts "CAR-T cell therapy"
 */

import 'dotenv/config'

import { runProjectsAgent } from '../src/lib/reports/agents/projects'
import { runTrialsAgent } from '../src/lib/reports/agents/trials'
import { runPatentsAgent } from '../src/lib/reports/agents/patents'
import { runPublicationsAgent } from '../src/lib/reports/agents/publications'
import { runMarketAgent } from '../src/lib/reports/agents/market'
import { synthesizeReport } from '../src/lib/reports/synthesize'
import type { AllAgentOutputs, FundingStats, OrgStats, ResearcherStats } from '../src/lib/reports/types'
import * as fs from 'fs'

const topic = process.argv[2] || 'CAR-T cell therapy'

async function main() {
  console.log(`\n=== Generating Test Report for "${topic}" ===\n`)

  const startTime = Date.now()

  // Phase 1a: Get projects first (other agents depend on project numbers)
  console.log('Phase 1a: Running projects agent...')
  const projectsOutput = await runProjectsAgent(topic)
  console.log(`  - Projects: ${projectsOutput.items.length}`)

  // Extract project numbers for dependent agents
  const projectNumbers = projectsOutput.items
    .map((p) => p.project_number)
    .filter((pn): pn is string => pn !== null && pn !== undefined)

  console.log(`  - Project numbers for linked data: ${projectNumbers.length}`)

  // Phase 1b: Run dependent agents in parallel
  // Projects are pre-filtered for relevance, so linked data is inherently relevant
  console.log('\nPhase 1b: Running linked data agents in parallel...')
  const [trialsOutput, patentsOutput, publicationsOutput, marketOutput] = await Promise.all([
    runTrialsAgent(projectNumbers),
    runPatentsAgent(projectNumbers),
    runPublicationsAgent(projectNumbers),
    runMarketAgent(topic),
  ])

  const agentOutputs: AllAgentOutputs = {
    projects: projectsOutput,
    trials: trialsOutput,
    patents: patentsOutput,
    publications: publicationsOutput,
    market: marketOutput,
  }

  console.log(`\nAgent data gathering complete (${((Date.now() - startTime) / 1000).toFixed(1)}s)`)
  console.log(`  - Projects: ${projectsOutput.items.length}`)
  console.log(`  - Trials: ${trialsOutput.items.length} (linked)`)
  console.log(`  - Patents: ${patentsOutput.items.length} (linked)`)
  console.log(`  - Publications: ${publicationsOutput.items.length} (linked)`)

  // Phase 2: Aggregation
  console.log('\nPhase 2: Aggregating statistics...')
  const fundingStats = calculateFundingStats(projectsOutput)
  const topOrgs = aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
  const topResearchers = aggregateResearchers(projectsOutput)

  console.log(`  - Total funding: $${(fundingStats.total / 1_000_000).toFixed(1)}M`)
  console.log(`  - Organizations: ${topOrgs.length}`)
  console.log(`  - Researchers: ${topResearchers.length}`)

  // Phase 3: Synthesis
  console.log('\nPhase 3: Synthesizing report...')
  const synthesisStart = Date.now()

  const reportData = await synthesizeReport(topic, agentOutputs, {
    userId: 'test-script-user', // Test script - usage tracking will be skipped for non-existent user
    fundingStats,
    topOrganizations: topOrgs,
    topResearchers,
    dataLimited: projectsOutput.items.length < 5,
  })

  console.log(`Synthesis complete (${((Date.now() - synthesisStart) / 1000).toFixed(1)}s)`)

  // Output markdown to file
  const filename = `report-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
  fs.writeFileSync(filename, reportData.markdownContent)
  console.log(`\n=== Report saved to ${filename} ===\n`)

  // Also output a text-friendly version to console
  console.log('\n' + '='.repeat(80))
  console.log('REPORT PREVIEW')
  console.log('='.repeat(80) + '\n')

  // Convert markdown to plain text (simple conversion)
  const plainText = reportData.markdownContent
    .replace(/^#{1,6}\s+/gm, '') // Remove heading markers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
    .replace(/\*([^*]+)\*/g, '$1') // Italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/`([^`]+)`/g, '$1') // Inline code
    .replace(/^\|.*\|$/gm, (line) => line.replace(/\|/g, ' | ').trim()) // Tables

  console.log(plainText)

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n=== Total generation time: ${totalTime}s ===\n`)
}

function calculateFundingStats(
  projectsOutput: AllAgentOutputs['projects']
): FundingStats {
  const items = projectsOutput.items
  const orgs = new Set<string>()
  const pis = new Set<string>()

  items.forEach((p) => {
    if (p.org_name) orgs.add(p.org_name)
    if (p.pi_names) {
      p.pi_names.split(';').forEach((name) => {
        const trimmed = name.trim()
        if (trimmed) pis.add(trimmed)
      })
    }
  })

  return {
    total: projectsOutput.totalFunding,
    projectCount: items.length,
    orgCount: orgs.size,
    piCount: pis.size,
    byYear: projectsOutput.byYear,
    byCategory: projectsOutput.byCategory,
    byOrg: projectsOutput.byOrg.slice(0, 10),
  }
}

function aggregateOrganizations(
  projects: AllAgentOutputs['projects'],
  trials: AllAgentOutputs['trials'],
  patents: AllAgentOutputs['patents']
): OrgStats[] {
  const orgMap = new Map<string, OrgStats>()

  projects.items.forEach((p) => {
    if (!p.org_name) return
    const existing = orgMap.get(p.org_name) || {
      org_name: p.org_name,
      projects: 0,
      funding: 0,
      trials: 0,
      patents: 0,
    }
    existing.projects++
    existing.funding += p.total_cost ?? 0
    orgMap.set(p.org_name, existing)
  })

  trials.items.forEach((t) => {
    if (!t.lead_sponsor) return
    const existing = orgMap.get(t.lead_sponsor) || {
      org_name: t.lead_sponsor,
      projects: 0,
      funding: 0,
      trials: 0,
      patents: 0,
    }
    existing.trials++
    orgMap.set(t.lead_sponsor, existing)
  })

  patents.items.forEach((p) => {
    if (!p.assignee) return
    const existing = orgMap.get(p.assignee) || {
      org_name: p.assignee,
      projects: 0,
      funding: 0,
      trials: 0,
      patents: 0,
    }
    existing.patents++
    orgMap.set(p.assignee, existing)
  })

  return Array.from(orgMap.values())
    .sort((a, b) => {
      const fundingDiff = b.funding - a.funding
      if (fundingDiff !== 0) return fundingDiff
      return (b.projects + b.trials + b.patents) - (a.projects + a.trials + a.patents)
    })
    .slice(0, 15)
}

function aggregateResearchers(
  projects: AllAgentOutputs['projects']
): ResearcherStats[] {
  const piMap = new Map<string, ResearcherStats>()

  projects.items.forEach((p) => {
    if (!p.pi_names) return
    const primaryPi = p.pi_names.split(';')[0]?.trim()
    if (!primaryPi) return

    const existing = piMap.get(primaryPi) || {
      pi_name: primaryPi,
      projects: 0,
      funding: 0,
      org: p.org_name,
    }
    existing.projects++
    existing.funding += p.total_cost ?? 0
    if (p.org_name) existing.org = p.org_name
    piMap.set(primaryPi, existing)
  })

  return Array.from(piMap.values())
    .sort((a, b) => b.funding - a.funding)
    .slice(0, 15)
}

main().catch(console.error)
