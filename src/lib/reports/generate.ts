// Report Generation Orchestrator
// Coordinates multi-agent data gathering and report synthesis

import { supabaseAdmin } from '@/lib/supabase'
import type {
  ReportType,
  ReportPersona,
  ReportData,
  AllAgentOutputs,
  GenerateReportOptions,
  FundingStats,
  OrgStats,
  ResearcherStats,
} from './types'
import { runProjectsAgent } from './agents/projects'
import { runTrialsAgent } from './agents/trials'
import { runPatentsAgent } from './agents/patents'
import { runPublicationsAgent } from './agents/publications'
import { runMarketAgent } from './agents/market'
import { synthesizeReport } from './synthesize'

/**
 * Quick check to count projects for a topic before full generation
 * Used to show "limited data" warning if < 5 projects
 */
export async function checkProjectCount(topic: string): Promise<number> {
  // Use semantic search to get approximate count
  const { data, error } = await supabaseAdmin.rpc('search_projects', {
    query_embedding: await getEmbedding(topic),
    match_threshold: 0.25,
    match_count: 100,
  })

  if (error) {
    console.error('Error checking project count:', error)
    return 0
  }

  return data?.length ?? 0
}

/**
 * Generate a topic-based research landscape report
 */
export async function generateTopicReport(
  userId: string,
  topic: string,
  dataLimited: boolean = false,
  persona: ReportPersona = 'researcher'
): Promise<string> {
  // Create report record with 'generating' status
  const { data: report, error: insertError } = await supabaseAdmin
    .from('user_reports')
    .insert({
      user_id: userId,
      title: `${topic} ${persona === 'investor' ? 'Investment' : 'Research'} Intelligence`,
      report_type: 'topic' as ReportType,
      topic,
      status: 'generating',
      data_limited: dataLimited,
      persona,
    })
    .select('id')
    .single()

  if (insertError || !report) {
    console.error('Failed to create report record:', insertError)
    throw new Error('Failed to create report')
  }

  const reportId = report.id

  try {
    // Phase 1a: Get projects first (other agents depend on project numbers)
    console.log(`[Report ${reportId}] Starting agent data gathering for "${topic}"`)

    const projectsOutput = await runProjectsAgent(topic)
    console.log(`[Report ${reportId}] Projects agent complete: ${projectsOutput.items.length} projects`)

    // Use all project_number variants from pre-deduplication for linked data lookup
    // This ensures we find trials/patents linked to any variant of a deduplicated project
    // e.g., "5R44MH136894-02" and "1R44MH136894-01" are the same project but linked data could be under either
    const projectNumbers = projectsOutput.allProjectNumbers

    console.log(`[Report ${reportId}] Found ${projectNumbers.length} project_number variants for linked data lookup`)

    // Phase 1b: Run dependent agents in parallel (they all use project numbers)
    // Market agent runs independently (doesn't need project numbers)
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

    console.log(`[Report ${reportId}] Agent data gathering complete`)
    console.log(`  - Projects: ${projectsOutput.items.length}`)
    console.log(`  - Trials: ${trialsOutput.items.length} (linked to ${projectNumbers.length} projects)`)
    console.log(`  - Patents: ${patentsOutput.items.length} (linked to ${projectNumbers.length} projects)`)
    console.log(`  - Publications: ${publicationsOutput.items.length} (linked to ${projectNumbers.length} projects)`)

    // Phase 2: Aggregation
    const fundingStats = calculateFundingStats(projectsOutput)
    const topOrgs = aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
    const topResearchers = aggregateResearchers(projectsOutput)

    // Phase 3: Synthesis - generate executive summary and markdown report
    console.log(`[Report ${reportId}] Synthesizing report for ${persona} persona...`)

    const reportData = await synthesizeReport(topic, agentOutputs, {
      fundingStats,
      topOrganizations: topOrgs,
      topResearchers,
      dataLimited,
      persona,
    })

    // Save completed report
    const { error: updateError } = await supabaseAdmin
      .from('user_reports')
      .update({
        status: 'complete',
        executive_summary: reportData.executiveSummary,
        market_context: reportData.marketContext,
        funding_stats: fundingStats,
        projects: reportData.projects,
        clinical_trials: reportData.clinicalTrials,
        patents: reportData.patents,
        publications: reportData.publications,
        top_organizations: topOrgs,
        top_researchers: topResearchers,
        markdown_content: reportData.markdownContent,
        agent_outputs: agentOutputs,
        project_count: projectsOutput.items.length,
        persona,
        signals_analysis: reportData.signalsAnalysis,
        curated_publications: reportData.curatedPublications,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId)

    if (updateError) {
      throw new Error(`Failed to save report: ${updateError.message}`)
    }

    console.log(`[Report ${reportId}] Report complete`)
    return reportId
  } catch (error) {
    // Mark report as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await supabaseAdmin
      .from('user_reports')
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId)

    console.error(`[Report ${reportId}] Failed:`, error)
    throw error
  }
}

/**
 * Generate a portfolio report from user's saved projects/trials
 */
export async function generatePortfolioReport(userId: string): Promise<string> {
  // Fetch user's saved items
  const [savedProjectsResult, savedTrialsResult] = await Promise.all([
    supabaseAdmin
      .from('saved_projects')
      .select('application_id, projects(*)')
      .eq('user_id', userId),
    supabaseAdmin
      .from('saved_trials')
      .select('nct_id, clinical_studies(*)')
      .eq('user_id', userId),
  ])

  const savedProjects = savedProjectsResult.data ?? []
  const savedTrials = savedTrialsResult.data ?? []

  if (savedProjects.length === 0 && savedTrials.length === 0) {
    throw new Error('No saved projects or trials to generate report from')
  }

  // Create report record
  const { data: report, error: insertError } = await supabaseAdmin
    .from('user_reports')
    .insert({
      user_id: userId,
      title: 'My Research Portfolio',
      report_type: 'portfolio' as ReportType,
      status: 'generating',
      data_limited: savedProjects.length < 5,
      project_count: savedProjects.length,
    })
    .select('id')
    .single()

  if (insertError || !report) {
    throw new Error('Failed to create report')
  }

  // TODO: Implement portfolio report generation
  // This follows similar pattern but uses saved items as data source

  return report.id
}

/**
 * Calculate funding statistics from projects
 */
function calculateFundingStats(
  projectsOutput: AllAgentOutputs['projects']
): FundingStats {
  const items = projectsOutput.items

  // Count unique orgs and PIs
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

/**
 * Aggregate organization stats across all data sources
 */
function aggregateOrganizations(
  projects: AllAgentOutputs['projects'],
  trials: AllAgentOutputs['trials'],
  patents: AllAgentOutputs['patents']
): OrgStats[] {
  const orgMap = new Map<string, OrgStats>()

  // Count from projects
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

  // Count trials by sponsor
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

  // Count patents by assignee
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

  // Sort by funding (primary), with activity as tiebreaker
  return Array.from(orgMap.values())
    .sort((a, b) => {
      // Primary sort: funding
      const fundingDiff = b.funding - a.funding
      if (fundingDiff !== 0) return fundingDiff
      // Tiebreaker: total activity
      return (b.projects + b.trials + b.patents) - (a.projects + a.trials + a.patents)
    })
    .slice(0, 15)
}

/**
 * Aggregate researcher stats from projects
 */
function aggregateResearchers(
  projects: AllAgentOutputs['projects']
): ResearcherStats[] {
  const piMap = new Map<string, ResearcherStats>()

  projects.items.forEach((p) => {
    if (!p.pi_names) return

    // Take first PI as primary
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
    // Update org to most recent
    if (p.org_name) existing.org = p.org_name
    piMap.set(primaryPi, existing)
  })

  // Sort by funding
  return Array.from(piMap.values())
    .sort((a, b) => b.funding - a.funding)
    .slice(0, 15)
}

/**
 * Get embedding for a text query
 */
async function getEmbedding(text: string): Promise<number[]> {
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}
