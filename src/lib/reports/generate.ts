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
import { getCoreProjectNumber } from '@/lib/project-number-utils'
import { runTrialsAgent } from './agents/trials'
import { runPatentsAgent } from './agents/patents'
import { runPublicationsAgent } from './agents/publications'
import { runMarketAgent } from './agents/market'
import { synthesizeReport } from './synthesize'
import { getCurrentNihFiscalYear, formatPartialFYLabel } from './fiscal-year'
import { autoGrantRetryCreditOnFailure } from '@/lib/billing/credits'

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

export interface InjectedInterpretation {
  /** Natural-language phrase used as the embedding-search input for both projects and trial semantic lookup. */
  semanticQuery: string
  /** Pipe-separated terms — UI-only metadata for the picker chips. Not used to drive backend search. */
  keywordQuery: string
  /** Human-readable label shown in the UI (e.g. 'Standard'). */
  label: string
}

/**
 * Generate a topic-based research landscape report
 *
 * @param injectedInterpretation - Optional human-chosen interpretation from
 *   the picker UI. If provided, anchors the projects agent on a known
 *   semantic query instead of regenerating one via Claude on each run.
 */
export async function generateTopicReport(
  userId: string,
  topic: string,
  dataLimited: boolean = false,
  persona: ReportPersona = 'researcher',
  injectedInterpretation?: InjectedInterpretation
): Promise<string> {
  // Create report record with 'generating' status. Persist the chosen
  // interpretation so the refresh / retry endpoints can reuse it without
  // re-deriving from markdown.
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
      interpretation: injectedInterpretation ?? null,
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
    const projectsOutput = await runProjectsAgent(topic, injectedInterpretation)
    console.log(`[Report ${reportId}] Projects agent complete: ${projectsOutput.items.length} projects`)

    // Use all project_number variants from pre-deduplication for linked data lookup
    // This ensures we find trials/patents linked to any variant of a deduplicated project
    // e.g., "5R44MH136894-02" and "1R44MH136894-01" are the same project but linked data could be under either
    const projectNumbers = projectsOutput.allProjectNumbers

    console.log(`[Report ${reportId}] Found ${projectNumbers.length} project_number variants for linked data lookup`)

    // Phase 1b: Run dependent agents in parallel (they all use project numbers)
    // Market agent runs independently (doesn't need project numbers)
    // Projects are pre-filtered for relevance, so linked data is inherently relevant
    await updateProgressStage(reportId, 'gathering_data')
    const trialsTopicQuery = injectedInterpretation?.semanticQuery ?? topic
    const [trialsOutput, patentsOutput, publicationsOutput, marketOutput] = await Promise.all([
      runTrialsAgent(projectNumbers, trialsTopicQuery),
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
    await updateProgressStage(reportId, 'aggregating')
    const fundingStats = calculateFundingStats(projectsOutput)
    const topOrgs = await aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
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
      interpretation: injectedInterpretation,
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
        // agent_outputs stores the raw agent outputs plus the synthesis
        // outputs that don't yet have dedicated columns (whiteSpace,
        // fieldMaturity, ipLandscape, competitiveTopology, surprisingFindings,
        // nextSteps). Nesting them here avoids a schema migration; a
        // dedicated column is a follow-up. Persisted so downstream
        // renderers can hydrate structural data instead of re-parsing markdown.
        agent_outputs: {
          ...agentOutputs,
          whiteSpace: reportData.whiteSpace,
          fieldMaturity: reportData.fieldMaturity,
          ipLandscape: reportData.ipLandscape,
          competitiveTopology: reportData.competitiveTopology,
          surprisingFindings: reportData.surprisingFindings,
          nextSteps: reportData.nextSteps,
        },
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

    // Auto-grant a retry credit so the user has a recovery path without
    // contacting support. Idempotent — duplicate failures (e.g. retried
    // webhooks) won't double-grant. Logged-not-thrown internally.
    await autoGrantRetryCreditOnFailure({
      userId,
      originalReportId: reportId,
    })

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
      runTrialsAgent(projectNumbers),
      runPatentsAgent(projectNumbers),
      runPublicationsAgent(projectNumbers),
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
    const topOrgs = await aggregateOrganizations(projectsOutput, trialsOutput, patentsOutput)
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
        // agent_outputs stores the raw agent outputs plus the synthesis
        // outputs that don't yet have dedicated columns (whiteSpace,
        // fieldMaturity, ipLandscape, competitiveTopology, surprisingFindings,
        // nextSteps). Nesting them here avoids a schema migration; a
        // dedicated column is a follow-up. Persisted so downstream
        // renderers can hydrate structural data instead of re-parsing markdown.
        agent_outputs: {
          ...agentOutputs,
          whiteSpace: reportData.whiteSpace,
          fieldMaturity: reportData.fieldMaturity,
          ipLandscape: reportData.ipLandscape,
          competitiveTopology: reportData.competitiveTopology,
          surprisingFindings: reportData.surprisingFindings,
          nextSteps: reportData.nextSteps,
        },
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
  study_type?: string | null
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
        study_type: t.study_type || null,
        study_status: t.study_status || null,
        lead_sponsor: t.lead_sponsor || null,
        conditions: t.conditions || null,
        enrollment_count: t.enrollment_count || null,
        // Saved-trials shortcut path has no project_number context — these
        // trials weren't surfaced via the linked-projects join, so they
        // can't be attributed to a funded org. Empty is the correct value.
        project_numbers: [],
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

  const currentFY = getCurrentNihFiscalYear()
  const hasPartialYear = projectsOutput.byYear.some((y) => y.isPartial)

  return {
    total: projectsOutput.totalFunding,
    projectCount: items.length,
    orgCount: orgs.size,
    piCount: pis.size,
    byYear: projectsOutput.byYear,
    byCategory: projectsOutput.byCategory,
    byOrg: projectsOutput.byOrg.slice(0, 10),
    currentFY,
    partialFYNote: hasPartialYear ? formatPartialFYLabel(currentFY) : undefined,
  }
}

/**
 * Aggregate organization stats across all data sources
 */
async function aggregateOrganizations(
  projects: AllAgentOutputs['projects'],
  trials: AllAgentOutputs['trials'],
  patents: AllAgentOutputs['patents']
): Promise<OrgStats[]> {
  // Keyed by normalized (lowercase) org name so case variants of the same
  // institution merge — projects table has "Johns Hopkins University"
  // and "JOHNS HOPKINS UNIVERSITY" as separate rows for the same place,
  // and patent_org / lead_sponsor add yet more casings. Without
  // normalization the rollup splits one institution across multiple rows
  // (the symptom that landed report-15 with 0/0 trials/patents on every
  // org while patents were clearly visible elsewhere in the report).
  const orgByKey = new Map<string, OrgStats>()
  const normalize = (name: string) => name.toLowerCase().trim()

  const ensureOrg = (orgName: string): OrgStats => {
    const key = normalize(orgName)
    const existing = orgByKey.get(key)
    if (existing) return existing
    const created: OrgStats = {
      org_name: orgName,
      projects: 0,
      funding: 0,
      trials: 0,
      patents: 0,
    }
    orgByKey.set(key, created)
    return created
  }

  // Count from projects (the funded org for each project)
  projects.items.forEach((p) => {
    if (!p.org_name) return
    const row = ensureOrg(p.org_name)
    row.projects++
    row.funding += p.total_cost ?? 0
  })

  // Build CORE-keyed project_number → org_name lookup. The projects table
  // is stored in mixed format (some rows in core form like "R01MH134973",
  // some in full form like "5R01MH134973-02"), but the linkage tables
  // (clinical_studies, project_patents) only store core form. Keying the
  // lookup by core form lets a trial linked to "R21CA283665" find an
  // analyzed project stored as "5R21CA283665-02". Verified 2026-06-29:
  // without this, UCLA and MGH showed 0 trials / 0 patents because all
  // their analyzed projects were stored in full form.
  const projectNumberToOrg = new Map<string, string>()
  for (const p of projects.items) {
    if (!p.project_number || !p.org_name) continue
    const core = getCoreProjectNumber(p.project_number)
    if (core) projectNumberToOrg.set(core, p.org_name)
    // Also key by the as-stored form for projects already in core format
    projectNumberToOrg.set(p.project_number, p.org_name)
  }

  // NOTE: an earlier version fetched external orgs (project_numbers not
  // in the analyzed sample) to fill in the map — this was removed after
  // r18 audit revealed it inflated top-org trial counts by attributing
  // trials to orgs whose sample projects were UNRELATED to those trials
  // (e.g., USC showed 8 trials but none linked to its 3 in-sample topic
  // projects — the 8 were linked to USC's other, out-of-topic projects).
  // Trials/patents now credit only orgs with an in-sample project
  // linkage. Trials that came in via semantic Path 2 (no project_number
  // at all) never credit any org here — they're semantic matches to the
  // topic itself, not to a funded org's project.

  // Attribute trials to orgs via project_number → org_name. Normalize each
  // trial's project_numbers to core form before lookup so the join works
  // regardless of whether the trial row stores core or full. Dedupe by
  // normalized org key so a trial linked to multiple project_numbers of
  // the same institution counts once.
  const findOrg = (pn: string): string | undefined => {
    const direct = projectNumberToOrg.get(pn)
    if (direct) return direct
    const core = getCoreProjectNumber(pn)
    if (core && core !== pn) return projectNumberToOrg.get(core)
    return undefined
  }

  trials.items.forEach((t) => {
    const seen = new Set<string>()
    for (const pn of t.project_numbers) {
      const org = findOrg(pn)
      if (!org) continue
      const key = normalize(org)
      if (seen.has(key)) continue
      seen.add(key)
      ensureOrg(org).trials++
    }
  })

  // Attribute patents the same way.
  patents.items.forEach((pt) => {
    const seen = new Set<string>()
    for (const pn of pt.project_numbers) {
      const org = findOrg(pn)
      if (!org) continue
      const key = normalize(org)
      if (seen.has(key)) continue
      seen.add(key)
      ensureOrg(org).patents++
    }
  })

  // Sort by PROJECT COUNT primary, funding as tiebreaker, activity third.
  // Rationale: the reader's mental model of "top orgs in this topic" is
  // "who has the most projects in the topic sample" — MGH with 10 topic
  // projects and $8.1M is a stronger topic player than UCLA with 6
  // projects and $8.8M, even though UCLA has slightly more funding
  // (r18 audit surfaced the funding-first sort as counterintuitive).
  return Array.from(orgByKey.values())
    .sort((a, b) => {
      const projDiff = b.projects - a.projects
      if (projDiff !== 0) return projDiff
      const fundingDiff = b.funding - a.funding
      if (fundingDiff !== 0) return fundingDiff
      return (b.trials + b.patents) - (a.trials + a.patents)
    })
    .slice(0, 15)
}

/**
 * Aggregate researcher stats from projects
 */
function aggregateResearchers(
  projects: AllAgentOutputs['projects']
): ResearcherStats[] {
  // Key by NORMALIZED PI name (lowercase trimmed) so case variants of the
  // same researcher merge — pi_names strings can vary across grants for
  // the same person ("ZHOU, XIANGHONG JASMINE" vs "Zhou, Xianghong Jasmine").
  // Without normalization the rollup splits one researcher into two rows.
  const piMap = new Map<string, ResearcherStats>()
  const normalize = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ')

  projects.items.forEach((p) => {
    if (!p.pi_names) return

    // Credit ALL PIs on the grant, not just the first. Multi-PI grants
    // (R01 dual-PI plans, U-mechanism cooperative agreements) are common
    // in NIH; only crediting the first PI undercounts later PIs and
    // overstates the lead PI's solo footprint. To avoid double-counting
    // funding on multi-PI grants, divide the funding evenly across PIs.
    const pis = p.pi_names
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (pis.length === 0) return
    const fundingPerPi = (p.total_cost ?? 0) / pis.length

    // Dedupe within this project so the same PI listed twice doesn't
    // get double-counted.
    const seenForThisProject = new Set<string>()
    for (const piRaw of pis) {
      const key = normalize(piRaw)
      if (!key || seenForThisProject.has(key)) continue
      seenForThisProject.add(key)

      const existing = piMap.get(key) || {
        pi_name: piRaw,
        projects: 0,
        funding: 0,
        org: p.org_name,
      }
      existing.projects++
      existing.funding += fundingPerPi
      // Keep the longest-form PI name as the display string (proper case
      // tends to be longer than ALL CAPS for the same name); falls back to
      // current value if neither is clearly better.
      if (piRaw.length > existing.pi_name.length) existing.pi_name = piRaw
      if (p.org_name) existing.org = p.org_name
      piMap.set(key, existing)
    }
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
