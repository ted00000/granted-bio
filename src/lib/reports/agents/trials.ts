// Trials Agent
// Searches clinical trials linked to NIH projects
// Enriches data from ClinicalTrials.gov if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { TrialsAgentOutput, TrialItem } from '../types'

const UNIFIED_THRESHOLD = 0.35

/**
 * Run the Trials Agent to gather clinical trial data for a topic
 * Uses hybrid approach: keyword search + project-linked search
 */
export async function runTrialsAgent(topic: string): Promise<TrialsAgentOutput> {
  console.log(`[Trials Agent] Searching for "${topic}"`)

  const queryEmbedding = await generateEmbedding(topic)

  // Extract primary term for keyword search
  const primaryTerm = topic.split(/\s+/)[0] // e.g., "CAR-T" or "CRISPR"

  const [keywordResult, linkedResult] = await Promise.all([
    // Keyword search on trial titles
    supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
      .ilike('study_title', `%${primaryTerm}%`)
      .order('start_date', { ascending: false })
      .limit(30),

    // Project-linked approach: find projects, get their linked trials
    (async () => {
      const { data: projects } = await supabaseAdmin.rpc('search_projects_filtered', {
        query_embedding: queryEmbedding,
        match_threshold: UNIFIED_THRESHOLD,
        match_count: 30,
        min_biotools_confidence: 0,
        filter_fiscal_years: null,
        filter_categories: null,
        filter_org_types: null,
        filter_states: null,
        filter_min_funding: null,
        filter_max_funding: null,
      })

      if (!projects || projects.length === 0) {
        return { data: null, error: null }
      }

      const projectNumbers = projects
        .map((p: { project_number: string }) => p.project_number)
        .filter(Boolean)

      if (projectNumbers.length === 0) {
        return { data: null, error: null }
      }

      // Get trials linked to these projects
      return supabaseAdmin
        .from('clinical_studies')
        .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
        .in('project_number', projectNumbers)
        .order('start_date', { ascending: false })
        .limit(30)
    })(),
  ])

  // Merge results, prioritizing keyword matches (more specific)
  const seenTrials = new Map<string, RawTrialResult>()

  // Add keyword results first
  if (keywordResult.data) {
    for (const trial of keywordResult.data) {
      if (!seenTrials.has(trial.nct_id)) {
        seenTrials.set(trial.nct_id, trial)
      }
    }
  }

  // Add linked trials that weren't already included
  if (linkedResult.data) {
    for (const trial of linkedResult.data) {
      if (!seenTrials.has(trial.nct_id)) {
        seenTrials.set(trial.nct_id, trial)
      }
    }
  }

  const mergedResults = Array.from(seenTrials.values())

  console.log(
    `[Trials Agent] Found ${mergedResults.length} trials ` +
      `(${keywordResult.data?.length || 0} keyword, ${linkedResult.data?.length || 0} linked)`
  )

  if (mergedResults.length === 0) {
    return emptyOutput()
  }

  // Check if any trials need enrichment
  const needsEnrichment = mergedResults.filter(
    (t) => !t.phase || !t.enrollment_count || !t.lead_sponsor
  )

  if (needsEnrichment.length > 0 && needsEnrichment.length <= 10) {
    console.log(`[Trials Agent] ${needsEnrichment.length} trials need enrichment`)
    await enrichTrials(needsEnrichment.map((t) => t.nct_id))

    // Refetch enriched data
    const nctIds = mergedResults.map((t) => t.nct_id)
    const { data: refreshed } = await supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
      .in('nct_id', nctIds)

    if (refreshed) {
      return processResults(refreshed)
    }
  }

  return processResults(mergedResults.slice(0, 30))
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawTrialResult[]): TrialsAgentOutput {
  // Map to TrialItem format
  const items: TrialItem[] = rawResults.map((t) => ({
    nct_id: t.nct_id,
    study_title: t.study_title,
    phase: t.phase || null,
    study_status: t.study_status || null,
    lead_sponsor: t.lead_sponsor || null,
    conditions: t.conditions || null,
    enrollment_count: t.enrollment_count || null,
  }))

  // Group by phase
  const byPhase: Record<string, number> = {}
  items.forEach((t) => {
    const phase = normalizePhase(t.phase)
    byPhase[phase] = (byPhase[phase] || 0) + 1
  })

  // Group by status
  const byStatus: Record<string, number> = {}
  items.forEach((t) => {
    const status = t.study_status || 'Unknown'
    byStatus[status] = (byStatus[status] || 0) + 1
  })

  console.log(`[Trials Agent] Processed ${items.length} trials`)
  console.log(`  - By phase:`, byPhase)

  return {
    items,
    byPhase,
    byStatus,
  }
}

/**
 * Normalize phase values for grouping
 */
function normalizePhase(phase: string | null): string {
  if (!phase) return 'Unknown'

  const p = phase.toUpperCase()
  if (p.includes('PHASE1') || p === 'PHASE 1') return 'Phase 1'
  if (p.includes('PHASE2') || p === 'PHASE 2') return 'Phase 2'
  if (p.includes('PHASE3') || p === 'PHASE 3') return 'Phase 3'
  if (p.includes('PHASE4') || p === 'PHASE 4') return 'Phase 4'
  if (p.includes('EARLY')) return 'Early Phase 1'
  if (p === 'NA' || p === 'N/A') return 'N/A'

  return phase
}

/**
 * Enrich trials by fetching from ClinicalTrials.gov API
 * Saves enriched data back to DB for future use
 */
async function enrichTrials(nctIds: string[]): Promise<void> {
  console.log(`[Trials Agent] Enriching ${nctIds.length} trials from ClinicalTrials.gov`)

  const batchSize = 5
  for (let i = 0; i < nctIds.length; i += batchSize) {
    const batch = nctIds.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async (nctId) => {
        try {
          const response = await fetch(
            `https://clinicaltrials.gov/api/v2/studies/${nctId}?fields=protocolSection`
          )

          if (!response.ok) {
            console.warn(`[Trials Agent] Failed to fetch ${nctId}: ${response.status}`)
            return
          }

          const data = await response.json()
          const protocol = data.protocolSection

          // Extract fields
          const phase = protocol?.designModule?.phases?.[0] || null
          const enrollmentCount = protocol?.designModule?.enrollmentInfo?.count || null
          const leadSponsor = protocol?.sponsorCollaboratorsModule?.leadSponsor?.name || null
          const conditions = protocol?.conditionsModule?.conditions || null
          const briefSummary = protocol?.descriptionModule?.briefSummary || null

          // Save to database
          await supabaseAdmin
            .from('clinical_studies')
            .update({
              phase,
              enrollment_count: enrollmentCount,
              lead_sponsor: leadSponsor,
              conditions,
              brief_summary: briefSummary,
              api_last_updated: new Date().toISOString(),
            })
            .eq('nct_id', nctId)
        } catch (error) {
          console.warn(`[Trials Agent] Error enriching ${nctId}:`, error)
        }
      })
    )

    // Rate limiting
    if (i + batchSize < nctIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

function emptyOutput(): TrialsAgentOutput {
  return {
    items: [],
    byPhase: {},
    byStatus: {},
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}

interface RawTrialResult {
  nct_id: string
  study_title: string
  study_status?: string | null
  phase?: string | null
  enrollment_count?: number | null
  lead_sponsor?: string | null
  conditions?: string[] | null
  brief_summary?: string | null
}
