/**
 * Lazy-on-view Haiku classifier for patent and publication flags.
 *
 * Replaces the legacy ETL keyword classifiers:
 *   - patents:      is_device_patent, is_therapeutic_patent, is_method_patent
 *                   (etl/process_patents.py — keyword match on patent_title only)
 *   - publications: is_methods_journal, is_therapeutic_journal, is_computational_journal
 *                   (etl/process_publications.py — keyword match on journal name)
 *
 * Both legacy classifiers have systematic quality issues:
 *   - Patents: chemistry-heavy titles ("Radiolabeled ligand conjugates
 *     for targeted alpha therapy") don't hit generic keywords like
 *     "device" or "treatment" but are clearly therapeutic patents.
 *   - Publications: journal-name classification is inherently coarse —
 *     "Nature" publishes all three categories indistinguishably.
 *
 * This classifier reads title + abstract (truncated) at article/patent
 * level and returns multi-label flag assignments.
 *
 * Fires lazy-on-view from /api/company/[id]: any item with
 * flags_classifier_version < CURRENT_CLASSIFIER_VERSION gets reclassified,
 * the flags are updated in DB, and version is bumped so subsequent views
 * skip the classifier. Cost per uncached view: ~$0.005-0.02 depending on
 * how many items surface. Once classified, free forever unless the
 * classifier version is bumped.
 *
 * Design borrows from src/lib/reports/white-space.ts classifySampleViaHaiku:
 *   - Direct client.messages.create (not generateStructured) so we can
 *     place cache_control on the fixed prefix.
 *   - Common tool schema (plain string category, defensive validation in
 *     code) so the tool prefix is identical across the two classifier
 *     calls (patents + pubs) — enables prompt caching if both fire in
 *     the same page load.
 *   - Never breaks the caller. On any failure (network, timeout, schema
 *     violation) returns null and the caller keeps the legacy flags.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { recordModelUsage, type UsageTracker } from '@/lib/reports/llm-json'
import { logApiUsage } from '@/lib/billing/usage'

// Bump this constant when the classifier prompt or model changes. All
// items with flags_classifier_version < CURRENT will be re-classified
// on their next detail-page view.
export const CURRENT_CLASSIFIER_VERSION = 1

const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001'
const ABSTRACT_MAX_CHARS = 200
const TIMEOUT_MS = 60_000
const MAX_TOKENS = 4000

// The three-label taxonomy for patents. Kept intentionally aligned with
// the existing legacy flag column names (device/therapeutic/method) so
// no downstream consumer breaks.
const PATENT_FLAGS = ['device', 'therapeutic', 'method'] as const
type PatentFlag = (typeof PATENT_FLAGS)[number]

// Same for publications (methods/therapeutic/computational).
const PUB_FLAGS = ['methods', 'therapeutic', 'computational'] as const
type PubFlag = (typeof PUB_FLAGS)[number]

interface PatentInput {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
}

interface PublicationInput {
  pmid: string
  pub_title: string | null
  abstract: string | null
}

interface PatentClassification {
  patent_id: string
  is_device_patent: boolean
  is_therapeutic_patent: boolean
  is_method_patent: boolean
}

interface PublicationClassification {
  pmid: string
  is_methods_journal: boolean
  is_therapeutic_journal: boolean
  is_computational_journal: boolean
}

// Common system prompt across both patent + pub classifier calls. Marked
// cacheable so if both fire in the same page load (typical case),
// call 2 reads the system prompt from cache.
const CLASSIFIER_SYSTEM_PROMPT = `You are classifying research artifacts (patents or publications) for a life-sciences intelligence platform. For each item you will be given a title and a short abstract snippet. You will assign zero, one, or multiple category flags per item.

The category set differs between patents and publications (specified in each user message). In either case, a single item can carry multiple flags:
- A patent that describes a drug delivery method for a therapeutic device is BOTH device AND therapeutic.
- A publication in a computational biology methods journal is BOTH methods AND computational.

CLASSIFICATION RULES:
1. Read for meaning, not just literal keyword presence. A patent titled "Chelator conjugates for site-specific radionuclide delivery" is clearly a therapeutic patent even without the words "treatment" or "therapy". A publication describing "algorithms for single-cell transcriptomics analysis" is both methods AND computational.
2. If none of the specific flags apply, return an empty flags array — better than forcing a label.
3. Multi-label is expected. Do not artificially pick just one flag when two clearly apply.
4. Return an assignment for every item. Do not skip any. Every id from the input list must appear exactly once in the assignments array.`

function truncateAbstract(text: string | null): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return '(no abstract)'
  if (clean.length <= ABSTRACT_MAX_CHARS) return clean
  return clean.substring(0, ABSTRACT_MAX_CHARS).trimEnd() + '…'
}

function formatPatent(p: PatentInput): string {
  return `[${p.patent_id}]\nTitle: ${(p.patent_title || '(untitled)').trim()}\nAbstract: ${truncateAbstract(p.patent_abstract)}`
}

function formatPublication(p: PublicationInput): string {
  return `[${p.pmid}]\nTitle: ${(p.pub_title || '(untitled)').trim()}\nAbstract: ${truncateAbstract(p.abstract)}`
}

// Common JSON schema across patent + pub calls. Category-list is a
// string array validated defensively in code (see filterFlags below).
// If we used enum here, the schema would differ between patents and
// pubs and the tool prefix would invalidate the prompt cache.
const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    assignments: {
      type: 'array',
      description: 'One entry per item. Every item id from the input list must appear exactly once.',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The item identifier shown in square brackets at the start of each item entry (patent_id for patents, pmid for publications).',
          },
          flags: {
            type: 'array',
            description: 'Zero or more category flags. See the user message for the allowed set (differs between patents and publications).',
            items: { type: 'string' },
          },
        },
        required: ['id', 'flags'],
      },
    },
  },
  required: ['assignments'],
}

interface RawAssignment {
  id: string
  flags: string[]
}

async function classifyBatch(
  items: string, // pre-formatted item list
  perCallAsk: string, // per-call category description + task ask
  client: Anthropic,
  usageTracker: UsageTracker,
  label: string, // 'patents' | 'publications' — for logs
): Promise<RawAssignment[] | null> {
  let response
  try {
    response = await client.messages.create(
      {
        model: CLASSIFIER_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: CLASSIFIER_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `ITEMS TO CLASSIFY:\n\n${items}`,
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: perCallAsk },
            ],
          },
        ],
        tools: [
          {
            name: 'return_classifications',
            description: 'Return one flags array per item using the category names shown in the user message.',
            input_schema: OUTPUT_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'return_classifications' },
      },
      { timeout: TIMEOUT_MS },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[LazyFlags] ${label} classifier call failed: ${msg}. Keeping legacy flags.`)
    return null
  }

  recordModelUsage(usageTracker, CLASSIFIER_MODEL, response.usage)
  const cacheWrite = (response.usage as unknown as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0
  const cacheRead = (response.usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0
  if (cacheWrite > 0 || cacheRead > 0) {
    console.log(`[LazyFlags] ${label} cache tokens: write=${cacheWrite}, read=${cacheRead}`)
  }

  const toolUse = response.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    console.warn(`[LazyFlags] ${label} — no tool_use block in response.`)
    return null
  }
  const input = toolUse.input as { assignments?: RawAssignment[] }
  if (!input || !Array.isArray(input.assignments)) {
    console.warn(`[LazyFlags] ${label} — missing assignments array in tool_use input.`)
    return null
  }
  return input.assignments
}

function filterFlags<T extends string>(flags: string[], allowed: readonly T[]): Set<T> {
  const allowedSet = new Set<string>(allowed as readonly string[])
  const out = new Set<T>()
  for (const f of flags || []) {
    if (typeof f === 'string' && allowedSet.has(f)) out.add(f as T)
  }
  return out
}

/**
 * Classify a batch of patents against the device/therapeutic/method
 * flag set. Returns null if the classifier failed — caller should keep
 * the legacy flag values.
 */
async function classifyPatentsHaiku(
  patents: PatentInput[],
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<PatentClassification[] | null> {
  if (patents.length === 0) return []
  const itemsText = patents.map(formatPatent).join('\n\n')
  const perCallAsk = `TASK: For each patent above, decide which of the following flags apply. Multi-label is expected — a single patent can carry multiple flags.

ALLOWED FLAGS (return zero or more per patent):
- device: The patent describes a physical apparatus, hardware, instrumentation, imaging system, sensor, or diagnostic device.
- therapeutic: The patent describes a treatment, therapy, drug, vaccine, radioligand, pharmaceutical composition, or method of treating disease.
- method: The patent describes a process, procedure, workflow, chemistry synthesis method, assay method, imaging method, or analytical method (as opposed to a product).

Return one classification per patent via the return_classifications tool. Use the patent_id shown in square brackets.`

  const raw = await classifyBatch(itemsText, perCallAsk, client, usageTracker, 'patents')
  if (raw === null) return null

  const byId = new Map(raw.map((r) => [r.id, r]))
  return patents.map((p) => {
    const assignment = byId.get(p.patent_id)
    const flags = assignment ? filterFlags(assignment.flags, PATENT_FLAGS) : new Set<PatentFlag>()
    return {
      patent_id: p.patent_id,
      is_device_patent: flags.has('device'),
      is_therapeutic_patent: flags.has('therapeutic'),
      is_method_patent: flags.has('method'),
    }
  })
}

/**
 * Classify a batch of publications against the methods/therapeutic/
 * computational flag set. Returns null if the classifier failed.
 */
async function classifyPublicationsHaiku(
  pubs: PublicationInput[],
  client: Anthropic,
  usageTracker: UsageTracker,
): Promise<PublicationClassification[] | null> {
  if (pubs.length === 0) return []
  const itemsText = pubs.map(formatPublication).join('\n\n')
  const perCallAsk = `TASK: For each publication above, decide which of the following flags apply. Multi-label is expected — a single article can carry multiple flags (a methods paper on computational drug discovery is BOTH methods AND computational).

ALLOWED FLAGS (return zero or more per publication):
- methods: The article's primary contribution is a new experimental technique, assay, protocol, or measurement method.
- therapeutic: The article describes a treatment, therapy, clinical intervention, drug, vaccine, radioligand, or pharmacological finding relevant to disease treatment.
- computational: The article describes algorithms, machine learning, statistical models, simulation, or purely computational analyses. In silico work counts here.

Return one classification per publication via the return_classifications tool. Use the pmid shown in square brackets.`

  const raw = await classifyBatch(itemsText, perCallAsk, client, usageTracker, 'publications')
  if (raw === null) return null

  const byId = new Map(raw.map((r) => [r.id, r]))
  return pubs.map((p) => {
    const assignment = byId.get(p.pmid)
    const flags = assignment ? filterFlags(assignment.flags, PUB_FLAGS) : new Set<PubFlag>()
    return {
      pmid: p.pmid,
      is_methods_journal: flags.has('methods'),
      is_therapeutic_journal: flags.has('therapeutic'),
      is_computational_journal: flags.has('computational'),
    }
  })
}

// ------------------------------------------------------------------
// Public entry point.
// ------------------------------------------------------------------

interface PatentRow extends PatentInput {
  is_device_patent?: boolean | null
  is_therapeutic_patent?: boolean | null
  is_method_patent?: boolean | null
  flags_classifier_version?: number | null
}

interface PublicationRow extends PublicationInput {
  is_methods_journal?: boolean | null
  is_therapeutic_journal?: boolean | null
  is_computational_journal?: boolean | null
  flags_classifier_version?: number | null
}

/**
 * Given the surfaced patents + publications for a project or company
 * page, classify any that haven't yet been touched by the current
 * Haiku classifier version. Writes results back to the DB (so future
 * views skip the classifier) AND returns the updated rows so the
 * caller can respond with fresh flags without a re-select roundtrip.
 *
 * Safe to call with mixed already-classified and unclassified rows;
 * only the stale ones fire the LLM. If nothing needs classification,
 * returns the input as-is with zero LLM cost.
 *
 * On any classifier failure, the affected rows keep their existing
 * legacy flags. The DB row is not updated (flags_classifier_version
 * stays 0) so the next view will retry. Never throws.
 */
export async function classifyLazyFlags({
  patents,
  publications,
  userId,
}: {
  patents: PatentRow[]
  publications: PublicationRow[]
  /**
   * User whose page-view triggered the classifier. Cost is attributed
   * to them in api_usage under endpoint='lazy_classifier'. Optional so
   * that server-side jobs (backfill scripts, etc.) can call this without
   * a user; those calls skip api_usage logging.
   */
  userId?: string
}): Promise<{
  patents: PatentRow[]
  publications: PublicationRow[]
  usage: UsageTracker
}> {
  const stalePatents = patents.filter(
    (p) => (p.flags_classifier_version ?? 0) < CURRENT_CLASSIFIER_VERSION,
  )
  const stalePubs = publications.filter(
    (p) => (p.flags_classifier_version ?? 0) < CURRENT_CLASSIFIER_VERSION,
  )
  const usage: UsageTracker = { inputTokens: 0, outputTokens: 0 }

  if (stalePatents.length === 0 && stalePubs.length === 0) {
    return { patents, publications, usage }
  }

  const client = new Anthropic()

  // Fire the two classifier calls in sequence (not parallel) so the
  // second call reads the cached system prompt written by the first.
  // Small wall-time cost (~2-3s serialized vs parallel); saves ~$0.001
  // in cache tokens per call. Also keeps rate-limit pressure lower.
  const patentResults = stalePatents.length > 0
    ? await classifyPatentsHaiku(stalePatents, client, usage)
    : []
  const pubResults = stalePubs.length > 0
    ? await classifyPublicationsHaiku(stalePubs, client, usage)
    : []

  // Merge classifier results back into the input arrays; write to DB.
  // Any batch that came back null (classifier failure) is skipped —
  // the input rows keep their legacy flags for this response, and
  // their flags_classifier_version stays 0 so the next view retries.

  const patentUpdates = patentResults ?? []
  const patentById = new Map(patentUpdates.map((c) => [c.patent_id, c]))
  const mergedPatents = patents.map((p) => {
    const updated = patentById.get(p.patent_id)
    if (!updated) return p
    return {
      ...p,
      is_device_patent: updated.is_device_patent,
      is_therapeutic_patent: updated.is_therapeutic_patent,
      is_method_patent: updated.is_method_patent,
      flags_classifier_version: CURRENT_CLASSIFIER_VERSION,
    }
  })

  const pubUpdates = pubResults ?? []
  const pubById = new Map(pubUpdates.map((c) => [c.pmid, c]))
  const mergedPubs = publications.map((p) => {
    const updated = pubById.get(p.pmid)
    if (!updated) return p
    return {
      ...p,
      is_methods_journal: updated.is_methods_journal,
      is_therapeutic_journal: updated.is_therapeutic_journal,
      is_computational_journal: updated.is_computational_journal,
      flags_classifier_version: CURRENT_CLASSIFIER_VERSION,
    }
  })

  // Fire DB writes in parallel; do NOT await inside the response path.
  // The classifier already returned fresh flags to the caller; the DB
  // writeback is bookkeeping so subsequent views skip the LLM. If the
  // writeback fails (network, transient) the next view will just fire
  // the classifier again — the classification is idempotent.
  void writePatentUpdates(patentUpdates).catch((err) => {
    console.warn('[LazyFlags] patent DB writeback failed:', err)
  })
  void writePublicationUpdates(pubUpdates).catch((err) => {
    console.warn('[LazyFlags] publication DB writeback failed:', err)
  })

  console.log(
    `[LazyFlags] classified ${patentUpdates.length}/${stalePatents.length} patents, ` +
    `${pubUpdates.length}/${stalePubs.length} publications; ` +
    `usage: ${usage.inputTokens} input / ${usage.outputTokens} output tokens`,
  )

  // Persist token spend to api_usage so the classifier's cost shows up
  // in monthly-spend dashboards and matches Anthropic-side billing.
  // One row per model that actually fired (both calls are Haiku today
  // but the loop is model-agnostic in case that changes). Skipped when
  // no userId is provided — server-side backfill scripts don't attribute.
  if (userId && usage.byModel) {
    for (const [model, counts] of Object.entries(usage.byModel)) {
      if (counts.inputTokens === 0 && counts.outputTokens === 0) continue
      void logApiUsage({
        userId,
        endpoint: 'lazy_classifier',
        model,
        inputTokens: counts.inputTokens,
        outputTokens: counts.outputTokens,
        cacheReadTokens: counts.cacheReadTokens,
        cacheWriteTokens: counts.cacheWriteTokens,
      }).catch((err) => {
        console.warn('[LazyFlags] api_usage log failed:', err)
      })
    }
  }

  return { patents: mergedPatents, publications: mergedPubs, usage }
}

async function writePatentUpdates(updates: PatentClassification[]): Promise<void> {
  if (updates.length === 0) return
  // Supabase doesn't support batch update-by-different-values in one
  // statement, so we fan out one UPDATE per row. Runs in parallel via
  // Promise.all — small N (≤50 per page load).
  await Promise.all(
    updates.map((u) =>
      supabaseAdmin
        .from('patents')
        .update({
          is_device_patent: u.is_device_patent,
          is_therapeutic_patent: u.is_therapeutic_patent,
          is_method_patent: u.is_method_patent,
          flags_classifier_version: CURRENT_CLASSIFIER_VERSION,
        })
        .eq('patent_id', u.patent_id),
    ),
  )
}

async function writePublicationUpdates(updates: PublicationClassification[]): Promise<void> {
  if (updates.length === 0) return
  await Promise.all(
    updates.map((u) =>
      supabaseAdmin
        .from('publications')
        .update({
          is_methods_journal: u.is_methods_journal,
          is_therapeutic_journal: u.is_therapeutic_journal,
          is_computational_journal: u.is_computational_journal,
          flags_classifier_version: CURRENT_CLASSIFIER_VERSION,
        })
        .eq('pmid', u.pmid),
    ),
  )
}
