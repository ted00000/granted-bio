// Trials Agent
// Searches clinical trials and enriches data from ClinicalTrials.gov if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { TrialsAgentOutput, TrialItem } from '../types'

/**
 * Run the Trials Agent to gather clinical trial data for a topic
 */
export async function runTrialsAgent(topic: string): Promise<TrialsAgentOutput> {
  console.log(`[Trials Agent] Searching for "${topic}"`)

  // Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(topic)

  // Search for trials using semantic similarity
  const { data, error } = await supabaseAdmin.rpc('search_clinical_studies', {
    query_embedding: queryEmbedding,
    match_threshold: 0.30, // Lower threshold for broader results
    match_count: 30,
  })

  if (error) {
    console.error('[Trials Agent] Search error:', error)
    return emptyOutput()
  }

  const rawResults = (data || []) as RawTrialResult[]

  // Check if any trials need enrichment (missing phase or conditions)
  const needsEnrichment = rawResults.filter(
    (t) => !t.phase || !t.enrollment_count || !t.lead_sponsor
  )

  if (needsEnrichment.length > 0) {
    console.log(`[Trials Agent] ${needsEnrichment.length} trials need enrichment`)
    await enrichTrials(needsEnrichment.map((t) => t.nct_id))
  }

  // Fetch full trial data with conditions
  const nctIds = rawResults.map((t) => t.nct_id)
  const { data: fullTrials } = await supabaseAdmin
    .from('clinical_studies')
    .select('nct_id, study_title, study_status, phase, enrollment_count, lead_sponsor, conditions')
    .in('nct_id', nctIds)

  return processResults(fullTrials || rawResults)
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

  console.log(`[Trials Agent] Found ${items.length} trials`)
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
 */
async function enrichTrials(nctIds: string[]): Promise<void> {
  console.log(`[Trials Agent] Enriching ${nctIds.length} trials from ClinicalTrials.gov`)

  // Fetch in parallel with rate limiting (10 req/sec soft limit)
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
          const leadSponsor =
            protocol?.sponsorCollaboratorsModule?.leadSponsor?.name || null
          const conditions = protocol?.conditionsModule?.conditions || null
          const briefSummary = protocol?.descriptionModule?.briefSummary || null

          // Update database
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

    // Rate limiting pause between batches
    if (i + batchSize < nctIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

/**
 * Return empty output when search fails
 */
function emptyOutput(): TrialsAgentOutput {
  return {
    items: [],
    byPhase: {},
    byStatus: {},
  }
}

/**
 * Generate embedding using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}

// Type for raw database results
interface RawTrialResult {
  nct_id: string
  study_title: string
  study_status?: string | null
  phase?: string | null
  enrollment_count?: number | null
  lead_sponsor?: string | null
  conditions?: string[] | null
}
