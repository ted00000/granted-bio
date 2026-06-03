// Trials Agent
// Fetches clinical trials via two parallel paths:
//  1. Trials linked to topically-relevant projects (via project_number)
//  2. Trials whose own title semantically matches the topic (vector search
//     over study_embedding, gated by TRIAL_INCLUSION_THRESHOLD)
//
// Path 2 catches trials linked through institutional umbrella grants
// (P30 cancer centers, etc.) whose underlying projects don't semantically
// match the topic — but the trials themselves are clearly about the topic.
// Their existence is reported; their umbrella-grant funding is not rolled
// into the report's funding totals (see FUNDING_ATTRIBUTION_THRESHOLD).
//
// Path 2 uses the same embedding-based mechanism as the projects agent
// rather than keyword ilike, so the picker's Narrow/Standard/Broad scope
// shapes trial recall coherently with project recall instead of swamping
// the section with any trial whose title contains a single common term.
//
// Enriches data from ClinicalTrials.gov if needed.

import { supabaseAdmin } from '@/lib/supabase'
import { generateEmbedding } from '@/lib/openai'
import type { TrialsAgentOutput, TrialItem } from '../types'
import { TRIAL_INCLUSION_THRESHOLD } from '../thresholds'

/**
 * Run the Trials Agent.
 *
 * @param projectNumbers - NIH project numbers of topically-relevant projects
 *   (path 1 source). All trials linked to these projects are included.
 * @param topicQuery - Optional natural-language phrase (typically the user's
 *   chosen interpretation's semanticQuery, or the raw topic). When provided,
 *   additionally surfaces trials whose study_title embedding clears
 *   TRIAL_INCLUSION_THRESHOLD against this phrase (path 2). Dedupes by NCT.
 */
export async function runTrialsAgent(
  projectNumbers: string[],
  topicQuery?: string
): Promise<TrialsAgentOutput> {
  console.log(
    `[Trials Agent] Path 1: fetching trials linked to ${projectNumbers.length} projects`
  )

  // Path 1 — trials linked to topically-relevant projects
  let linkedTrials: RawTrialResult[] = []
  if (projectNumbers.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
      .in('project_number', projectNumbers)
      .order('start_date', { ascending: false })

    if (error) {
      console.error('[Trials Agent] Path 1 error:', error)
    } else if (data) {
      linkedTrials = data
    }
  }

  // Path 2 — trials matched semantically by study_title embedding.
  // The search_clinical_studies RPC returns id/nct/title/status + similarity
  // but not the richer fields we need (phase, enrollment, sponsor, etc.), so
  // we use it as a candidate filter and then re-fetch full rows by NCT id.
  let semanticTrials: RawTrialResult[] = []
  if (topicQuery && topicQuery.trim().length > 0) {
    console.log(
      `[Trials Agent] Path 2: semantic title search at threshold ${TRIAL_INCLUSION_THRESHOLD}`
    )
    try {
      const queryEmbedding = await generateEmbedding(topicQuery)
      const { data: candidates, error: rpcError } = await supabaseAdmin.rpc(
        'search_clinical_studies',
        {
          query_embedding: queryEmbedding,
          match_threshold: TRIAL_INCLUSION_THRESHOLD,
          match_count: 150,
        }
      )

      if (rpcError) {
        console.error('[Trials Agent] Path 2 RPC error:', rpcError)
      } else if (candidates && candidates.length > 0) {
        const nctIds = Array.from(
          new Set(candidates.map((c: { nct_id: string }) => c.nct_id))
        )
        const { data: fullRows, error: fetchError } = await supabaseAdmin
          .from('clinical_studies')
          .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
          .in('nct_id', nctIds)

        if (fetchError) {
          console.error('[Trials Agent] Path 2 fetch error:', fetchError)
        } else if (fullRows) {
          semanticTrials = fullRows
        }
      }
    } catch (err) {
      console.error('[Trials Agent] Path 2 embedding error:', err)
    }
  }

  console.log(
    `[Trials Agent] Path 1: ${linkedTrials.length} rows | Path 2: ${semanticTrials.length} rows`
  )

  if (linkedTrials.length === 0 && semanticTrials.length === 0) {
    console.log('[Trials Agent] No trials found from either path')
    return emptyOutput()
  }

  // Union both paths, dedupe by NCT ID. Path 1 wins on conflict because its
  // project-link metadata is what enriches narrative coherence in the report.
  // Path 2 rows themselves may be duplicated (clinical_studies has one row
  // per (nct_id, project_number) so a multi-linked trial returns multiple
  // rows from the .in('nct_id') fetch); the NCT-keyed map collapses them.
  const seenTrials = new Map<string, RawTrialResult>()
  for (const trial of linkedTrials) {
    if (!seenTrials.has(trial.nct_id)) {
      seenTrials.set(trial.nct_id, trial)
    }
  }
  for (const trial of semanticTrials) {
    if (!seenTrials.has(trial.nct_id)) {
      seenTrials.set(trial.nct_id, trial)
    }
  }

  const uniqueTrials = Array.from(seenTrials.values())
  console.log(
    `[Trials Agent] ${uniqueTrials.length} unique trials after union (path1 + path2)`
  )

  // Check if any trials need enrichment
  const needsEnrichment = uniqueTrials.filter(
    (t) => !t.phase || !t.enrollment_count || !t.lead_sponsor
  )

  if (needsEnrichment.length > 0 && needsEnrichment.length <= 15) {
    console.log(`[Trials Agent] ${needsEnrichment.length} trials need enrichment`)
    await enrichTrials(needsEnrichment.map((t) => t.nct_id))

    // Refetch enriched data
    const nctIds = uniqueTrials.map((t) => t.nct_id)
    const { data: refreshed } = await supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions, brief_summary')
      .in('nct_id', nctIds)

    if (refreshed) {
      return processResults(refreshed)
    }
  }

  return processResults(uniqueTrials)
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawTrialResult[]): TrialsAgentOutput {
  // Dedup by NCT ID. clinical_studies has one row per (nct_id, project_number),
  // so a multi-linked trial fetched via .in('nct_id', ...) returns duplicates.
  // Making this idempotent lets every caller (including the post-enrichment
  // refetch) share the same processing path safely.
  const seen = new Map<string, RawTrialResult>()
  for (const t of rawResults) {
    if (!seen.has(t.nct_id)) seen.set(t.nct_id, t)
  }
  const deduped = Array.from(seen.values())

  // Map to TrialItem format
  const items: TrialItem[] = deduped.map((t) => ({
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
