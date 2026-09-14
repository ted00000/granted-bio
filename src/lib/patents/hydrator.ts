// Orchestrates the 3-call USPTO ODP flow for a single patent and
// writes the result into columns added by migration
// 20260914_patents_odp_enrichment.sql.
//
// Idempotent: if the row already has api_last_updated, does nothing.
// Failures (patent not in ODP, rate limit, network) are captured in
// hydration_error / hydration_error_at so the caller can present a
// meaningful message and we don't retry every page load.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  UsptoOdpError,
  searchApplicationNumber,
  fetchApplicationMetaData,
  fetchAssignmentHistory,
  type ApplicationMetaData,
  type AssignmentEntry,
} from './uspto-odp'

export type HydrationResult =
  | { status: 'hydrated' }
  | { status: 'already_hydrated' }
  | { status: 'not_found_in_odp' }
  | { status: 'rate_limited'; retryAfterSeconds: number | null }
  | { status: 'error'; error: string }

interface AssignmentHistoryEntry {
  conveyance: string | null
  recorded_date: string | null
  assignees: string[]
}

interface PatentUpdate {
  application_number: string
  patent_type: string | null
  patent_type_code: string | null
  patent_status: string | null
  filing_date: string | null
  issue_date: string | null
  examiner_name: string | null
  art_unit: string | null
  uspc_code: string | null
  cpc_codes: string[]
  inventors: string[]
  assignees: string[]
  current_assignees: string[]
  assignment_history: AssignmentHistoryEntry[]
  api_last_updated: string
  hydration_error: null
  hydration_error_at: null
  // Only write title if the row's existing title is missing, so we
  // don't clobber an already-good value with a possibly stale one.
  patent_title?: string | null
}

function extractInventors(meta: ApplicationMetaData): string[] {
  return (meta.inventorBag ?? [])
    .map((i) => i.inventorNameText?.trim())
    .filter((s): s is string => !!s)
}

function extractApplicants(meta: ApplicationMetaData): string[] {
  return (meta.applicantBag ?? [])
    .map((a) => a.applicantNameText?.trim())
    .filter((s): s is string => !!s)
}

function compactAssignmentHistory(entries: AssignmentEntry[]): AssignmentHistoryEntry[] {
  // Sort by recorded_date ascending so [-1] is always the newest.
  const sorted = [...entries].sort((a, b) => {
    const da = a.assignmentRecordedDate ?? a.assignmentReceivedDate ?? ''
    const db = b.assignmentRecordedDate ?? b.assignmentReceivedDate ?? ''
    return da.localeCompare(db)
  })
  return sorted.map((e) => ({
    conveyance: e.conveyanceText ?? null,
    recorded_date: e.assignmentRecordedDate ?? e.assignmentReceivedDate ?? null,
    assignees: (e.assigneeBag ?? [])
      .map((x) => x.assigneeNameText?.trim())
      .filter((s): s is string => !!s),
  }))
}

function currentAssigneesFromHistory(history: AssignmentHistoryEntry[]): string[] {
  if (history.length === 0) return []
  return history[history.length - 1].assignees
}

/**
 * Hydrate a single patent. Uses the admin (service-role) supabase
 * client because it writes across RLS to patents and needs to work
 * from an anonymous session context (public sample viewers can trigger).
 */
export async function hydratePatent(
  patentId: string,
  supabaseAdmin: SupabaseClient,
): Promise<HydrationResult> {
  // 1. Read the current row. Bail if already hydrated (idempotent).
  const cleanId = patentId.replace(/^US/i, '').replace(/[^0-9]/g, '')
  if (!cleanId) return { status: 'error', error: 'invalid_patent_id' }

  const { data: row, error: readErr } = await supabaseAdmin
    .from('patents')
    .select('patent_id, api_last_updated, patent_title')
    .eq('patent_id', cleanId)
    .maybeSingle()

  if (readErr) return { status: 'error', error: `db_read: ${readErr.message}` }
  if (!row) return { status: 'error', error: 'patent_not_in_index' }
  if (row.api_last_updated) return { status: 'already_hydrated' }

  // 2. Run the 3-call flow, catching typed errors as we go.
  try {
    const applicationNumber = await searchApplicationNumber(cleanId)
    if (!applicationNumber) {
      await supabaseAdmin
        .from('patents')
        .update({
          hydration_error: 'not_found_in_odp',
          hydration_error_at: new Date().toISOString(),
        })
        .eq('patent_id', cleanId)
      return { status: 'not_found_in_odp' }
    }

    const meta = await fetchApplicationMetaData(applicationNumber)
    if (!meta) {
      await supabaseAdmin
        .from('patents')
        .update({
          hydration_error: 'meta_data_empty',
          hydration_error_at: new Date().toISOString(),
        })
        .eq('patent_id', cleanId)
      return { status: 'not_found_in_odp' }
    }

    const assignments = (await fetchAssignmentHistory(applicationNumber)) ?? []
    const history = compactAssignmentHistory(assignments)

    // 3. Build update payload. Keep existing patent_title if present
    // — hydration should never overwrite a curated title with USPTO's
    // (usually identical, but occasionally the RePORTER-fed title has
    // been manually corrected).
    const update: PatentUpdate = {
      application_number: applicationNumber,
      patent_type: meta.applicationTypeLabelName ?? null,
      patent_type_code: meta.applicationTypeCode ?? null,
      patent_status: meta.applicationStatusDescriptionText ?? null,
      filing_date: meta.filingDate ?? null,
      issue_date: meta.grantDate ?? null,
      examiner_name: meta.examinerNameText ?? null,
      art_unit: meta.groupArtUnitNumber ?? null,
      uspc_code: meta.uspcSymbolText ?? null,
      cpc_codes: meta.cpcClassificationBag ?? [],
      inventors: extractInventors(meta),
      assignees: extractApplicants(meta),
      current_assignees: currentAssigneesFromHistory(history),
      assignment_history: history,
      api_last_updated: new Date().toISOString(),
      hydration_error: null,
      hydration_error_at: null,
    }
    if (!row.patent_title && meta.inventionTitle) {
      update.patent_title = meta.inventionTitle
    }

    const { error: writeErr } = await supabaseAdmin
      .from('patents')
      .update(update)
      .eq('patent_id', cleanId)

    if (writeErr) return { status: 'error', error: `db_write: ${writeErr.message}` }
    return { status: 'hydrated' }
  } catch (err) {
    if (err instanceof UsptoOdpError && err.status === 429) {
      // Rate limits are transient — do NOT persist as hydration_error,
      // so the next visit can retry once the window resets.
      return { status: 'rate_limited', retryAfterSeconds: err.retryAfterSeconds }
    }
    const message = err instanceof Error ? err.message : String(err)
    await supabaseAdmin
      .from('patents')
      .update({
        hydration_error: message.slice(0, 500),
        hydration_error_at: new Date().toISOString(),
      })
      .eq('patent_id', cleanId)
    return { status: 'error', error: message }
  }
}
