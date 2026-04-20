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
  ProjectItem,
  TrialItem,
  ProjectsAgentOutput,
} from './types'
import { runProjectsAgent } from './agents/projects'
import { runTrialsAgent } from './agents/trials'
import { runPatentsAgent } from './agents/patents'
import { runPublicationsAgent } from './agents/publications'
import { runMarketAgent } from './agents/market'
import { synthesizeReport } from './synthesize'

/**
 * Progress stage type for report generation
 */
type ProgressStage = 'searching_projects' | 'gathering_data' | 'aggregating' | 'synthesizing'

/**
 * Update the progress stage for a report
 * This is a fire-and-forget update - we don't want to block on it
 */
async function updateProgressStage(reportId: string, stage: ProgressStage): Promise<void> {
  try {
    await supabaseAdmin
      .from('user_reports')
      .update({ progress_stage: stage, updated_at: new Date().toISOString() })
      .eq('id', reportId)
  } catch (error) {
    console.error(`[Report ${reportId}] Failed to update progress stage to ${stage}:`, error)
    // Don't throw - progress updates are non-critical
  }
}

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
      title: `${topic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')} ${persona === 'investor' ? 'Investment' : 'Research'} Intelligence`,
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

    await updateProgressStage(reportId, 'searching_projects')
    const projectsOutput = await runProjectsAgent(topic)
    console.log(`[Report ${reportId}] Projects agent complete: ${projectsOutput.items.length} projects`)

    // Use all project_number variants from pre-deduplication for linked data lookup
    // This ensures we find trials/patents linked to any variant of a deduplicated project
    // e.g., "5R44MH136894-02" and "1R44MH136894-01" are the same project but linked data could be under either
    const projectNumbers = projectsOutput.allProjectNumbers

    console.log(`[Report ${reportId}] Found ${projectNumbers.length} project_number variants for linked data lookup`)

    // Phase 1b: Run dependent agents in parallel (they all use project numbers)
    // Market agent runs independently (doesn't need project numbers)
    // Each agent filters for topic relevance to ensure only related items are included
    await updateProgressStage(reportId, 'gathering_data')
    const [trialsOutput, patentsOutput, publicationsOutput, marketOutput] = await Promise.all([
      runTrialsAgent(projectNumbers, topic),
      runPatentsAgent(projectNumbers, topic),
      runPublicationsAgent(projectNumbers, topic),
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
    await updateProgressStage(reportId, 'aggregating')
    const fundingStats = calculateFundingStats(projectsOutput)
    const topOrgs = aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
    const topResearchers = aggregateResearchers(projectsOutput)

    // Phase 3: Synthesis - generate executive summary and markdown report
    console.log(`[Report ${reportId}] Synthesizing report for ${persona} persona...`)
    await updateProgressStage(reportId, 'synthesizing')

    const reportData = await synthesizeReport(topic, agentOutputs, {
      userId,
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
        progress_stage: null,
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
        progress_stage: null,
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
  // Fetch user's saved items with full project data
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

  const dataLimited = savedProjects.length < 5

  // Create report record
  const { data: report, error: insertError } = await supabaseAdmin
    .from('user_reports')
    .insert({
      user_id: userId,
      title: 'My Research Portfolio',
      report_type: 'portfolio' as ReportType,
      status: 'generating',
      data_limited: dataLimited,
      project_count: savedProjects.length,
      persona: 'researcher' as ReportPersona,
    })
    .select('id')
    .single()

  if (insertError || !report) {
    throw new Error('Failed to create report')
  }

  const reportId = report.id

  try {
    console.log(`[Portfolio Report ${reportId}] Starting generation for ${savedProjects.length} projects, ${savedTrials.length} trials`)

    await updateProgressStage(reportId, 'searching_projects')
    // Transform saved projects into ProjectsAgentOutput format
    const projectsOutput = transformSavedProjectsToOutput(savedProjects)
    console.log(`[Portfolio Report ${reportId}] Processed ${projectsOutput.items.length} projects`)

    // Get project numbers for linked data lookup
    const projectNumbers = projectsOutput.allProjectNumbers
    console.log(`[Portfolio Report ${reportId}] Found ${projectNumbers.length} project numbers for linked data`)

    // Run dependent agents in parallel to get trials, patents, publications linked to these projects
    // For market context, derive a topic from the portfolio's primary categories
    const portfolioTopic = derivePortfolioTopic(projectsOutput)
    console.log(`[Portfolio Report ${reportId}] Derived topic: "${portfolioTopic}"`)

    await updateProgressStage(reportId, 'gathering_data')
    const [trialsOutput, patentsOutput, publicationsOutput, marketOutput] = await Promise.all([
      runTrialsAgent(projectNumbers, portfolioTopic),
      runPatentsAgent(projectNumbers, portfolioTopic),
      runPublicationsAgent(projectNumbers, portfolioTopic),
      runMarketAgent(portfolioTopic),
    ])

    // Include any saved trials that weren't linked to projects
    const linkedTrialIds = new Set(trialsOutput.items.map(t => t.nct_id))
    const additionalTrials = transformSavedTrialsToItems(savedTrials, linkedTrialIds)
    if (additionalTrials.length > 0) {
      console.log(`[Portfolio Report ${reportId}] Adding ${additionalTrials.length} saved trials not linked to projects`)
      trialsOutput.items.push(...additionalTrials)
    }

    const agentOutputs: AllAgentOutputs = {
      projects: projectsOutput,
      trials: trialsOutput,
      patents: patentsOutput,
      publications: publicationsOutput,
      market: marketOutput,
    }

    console.log(`[Portfolio Report ${reportId}] Agent data gathering complete`)
    console.log(`  - Projects: ${projectsOutput.items.length}`)
    console.log(`  - Trials: ${trialsOutput.items.length}`)
    console.log(`  - Patents: ${patentsOutput.items.length}`)
    console.log(`  - Publications: ${publicationsOutput.items.length}`)

    // Aggregation
    await updateProgressStage(reportId, 'aggregating')
    const fundingStats = calculateFundingStats(projectsOutput)
    const topOrgs = aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
    const topResearchers = aggregateResearchers(projectsOutput)

    // Synthesis
    console.log(`[Portfolio Report ${reportId}] Synthesizing report...`)
    await updateProgressStage(reportId, 'synthesizing')

    const reportData = await synthesizeReport(portfolioTopic, agentOutputs, {
      userId,
      fundingStats,
      topOrganizations: topOrgs,
      topResearchers,
      dataLimited,
      persona: 'researcher',
    })

    // Save completed report
    const { error: updateError } = await supabaseAdmin
      .from('user_reports')
      .update({
        status: 'complete',
        progress_stage: null,
        topic: portfolioTopic,
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
        signals_analysis: reportData.signalsAnalysis,
        curated_publications: reportData.curatedPublications,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId)

    if (updateError) {
      throw new Error(`Failed to save report: ${updateError.message}`)
    }

    console.log(`[Portfolio Report ${reportId}] Report complete`)
    return reportId
  } catch (error) {
    // Mark report as failed
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await supabaseAdmin
      .from('user_reports')
      .update({
        status: 'failed',
        progress_stage: null,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reportId)

    console.error(`[Portfolio Report ${reportId}] Failed:`, error)
    throw error
  }
}

/**
 * Transform saved projects into ProjectsAgentOutput format
 */
interface ProjectData {
  application_id: string
  project_number?: string | null
  title?: string | null
  phr?: string | null
  pi_names?: string | null
  org_name?: string | null
  total_cost?: number | null
  fiscal_year?: number | null
  primary_category?: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformSavedProjectsToOutput(savedProjects: any[]): ProjectsAgentOutput {
  // Extract project data from joined results
  // Supabase returns the relation as a single object (many-to-one)
  const items: ProjectItem[] = savedProjects
    .filter(sp => sp.projects !== null && sp.projects !== undefined)
    .map(sp => {
      const p = sp.projects as ProjectData
      return {
        application_id: p.application_id,
        project_number: p.project_number || null,
        title: p.title || 'Untitled Project',
        abstract: p.phr || null,
        pi_names: p.pi_names || null,
        org_name: p.org_name || null,
        total_cost: p.total_cost || null,
        fiscal_year: p.fiscal_year || null,
        primary_category: p.primary_category || null,
        similarity: null,
        match_tier: null,
      }
    })

  // Calculate total funding
  const totalFunding = items.reduce((sum, p) => sum + (p.total_cost || 0), 0)

  // Collect all project numbers for linked data lookup
  const allProjectNumbers = items
    .map(p => p.project_number)
    .filter((pn): pn is string => pn !== null && pn.trim() !== '')

  // Group by fiscal year
  const byYearMap = new Map<number, { projects: number; funding: number }>()
  items.forEach((p) => {
    if (!p.fiscal_year) return
    const existing = byYearMap.get(p.fiscal_year) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
    byYearMap.set(p.fiscal_year, existing)
  })
  const byYear = Array.from(byYearMap.entries())
    .map(([year, data]) => ({ year, ...data }))
    .sort((a, b) => b.year - a.year)

  // Group by category
  const byCategoryMap = new Map<string, { projects: number; funding: number }>()
  items.forEach((p) => {
    const category = p.primary_category || 'other'
    const existing = byCategoryMap.get(category) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
    byCategoryMap.set(category, existing)
  })
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.funding - a.funding)

  // Group by organization
  const byOrgMap = new Map<string, { projects: number; funding: number }>()
  items.forEach((p) => {
    if (!p.org_name) return
    const existing = byOrgMap.get(p.org_name) || { projects: 0, funding: 0 }
    existing.projects++
    existing.funding += p.total_cost || 0
    byOrgMap.set(p.org_name, existing)
  })
  const byOrg = Array.from(byOrgMap.entries())
    .map(([org, data]) => ({ org, ...data }))
    .sort((a, b) => b.funding - a.funding)
    .slice(0, 15)

  return {
    items,
    totalFunding,
    byYear,
    byCategory,
    byOrg,
    allProjectNumbers,
  }
}

/**
 * Transform saved trials into TrialItem format
 * Only returns trials not already present in linkedTrialIds
 */
interface TrialData {
  nct_id: string
  study_title?: string | null
  phase?: string | null
  study_status?: string | null
  lead_sponsor?: string | null
  conditions?: string[] | null
  enrollment_count?: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformSavedTrialsToItems(
  savedTrials: any[],
  linkedTrialIds: Set<string>
): TrialItem[] {
  return savedTrials
    .filter(st => st.clinical_studies !== null && st.clinical_studies !== undefined && !linkedTrialIds.has(st.nct_id))
    .map(st => {
      const t = st.clinical_studies as TrialData
      return {
        nct_id: t.nct_id,
        study_title: t.study_title || 'Untitled Study',
        phase: t.phase || null,
        study_status: t.study_status || null,
        lead_sponsor: t.lead_sponsor || null,
        conditions: t.conditions || null,
        enrollment_count: t.enrollment_count || null,
      }
    })
}

/**
 * Derive a topic description from the portfolio's projects
 * Used for market context generation
 */
function derivePortfolioTopic(projectsOutput: ProjectsAgentOutput): string {
  // Use top categories to describe the portfolio
  const topCategories = projectsOutput.byCategory
    .slice(0, 3)
    .map(c => c.category)
    .filter(c => c !== 'other')

  if (topCategories.length > 0) {
    return `${topCategories.join(', ')} research`
  }

  // Fallback: extract common terms from project titles
  const titleWords = projectsOutput.items
    .flatMap(p => p.title.toLowerCase().split(/\s+/))
    .filter(w => w.length > 4 && !['study', 'using', 'based', 'novel', 'research'].includes(w))

  const wordCounts = new Map<string, number>()
  titleWords.forEach(w => wordCounts.set(w, (wordCounts.get(w) || 0) + 1))

  const topWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)

  if (topWords.length > 0) {
    return `${topWords.join(', ')} research`
  }

  return 'biomedical research portfolio'
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
