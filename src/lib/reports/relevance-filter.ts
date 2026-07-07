// Topic Relevance Filter
// Filters items (trials, patents, publications) to ensure they're actually
// relevant to the report topic. Two flavors:
//   1. `filterForRelevance` — generic 2-way (relevant/not-relevant),
//      batches of 30, useful for any FilterableItem list.
//   2. `filterTrialsAndPatentsByRelevance` — trial + patent batched into
//      one LLM call, 3-way verdicts (relevant/tangential/unrelated) so
//      the render layer can keep tangential items visible while dropping
//      clearly off-topic ones. This is the primary use for the report
//      Active Trials / Key Patents sections.

import Anthropic from '@anthropic-ai/sdk'
import type { PatentItem, TrialItem } from './types'

const anthropic = new Anthropic()

interface FilterableItem {
  id: string
  title: string
  description?: string | null
}

interface FilterResult {
  kept: string[]
  removed: string[]
}

/**
 * Filter items for topic relevance using AI
 * Returns IDs of items that are actually relevant to the topic
 *
 * @param topic - The report topic (e.g., "monoclonal antibody production")
 * @param items - Items to filter, each with id, title, and optional description
 * @param itemType - Type of items for logging (e.g., "trials", "patents", "publications")
 * @returns Object with arrays of kept and removed item IDs
 */
export async function filterForRelevance(
  topic: string,
  items: FilterableItem[],
  itemType: string
): Promise<FilterResult> {
  if (items.length === 0) {
    return { kept: [], removed: [] }
  }

  // For small batches, filter all at once
  // For larger batches, process in chunks to stay within context limits
  const BATCH_SIZE = 30
  const allKept: string[] = []
  const allRemoved: string[] = []

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const result = await filterBatch(topic, batch, itemType)
    allKept.push(...result.kept)
    allRemoved.push(...result.removed)
  }

  console.log(`[Relevance Filter] ${itemType}: kept ${allKept.length}/${items.length} items`)

  return { kept: allKept, removed: allRemoved }
}

/**
 * Filter a single batch of items
 */
async function filterBatch(
  topic: string,
  items: FilterableItem[],
  itemType: string
): Promise<FilterResult> {
  // Build the items list for the prompt
  const itemsList = items.map((item, idx) => {
    const desc = item.description ? ` - ${item.description.slice(0, 200)}` : ''
    return `${idx + 1}. [${item.id}] ${item.title}${desc}`
  }).join('\n')

  const prompt = `You are filtering ${itemType} for a research report about "${topic}".

Review each item below and determine if it is DIRECTLY RELEVANT to the topic "${topic}".

An item is relevant if:
- It directly involves or advances the topic
- It studies applications or methods core to the topic
- It would be valuable information for someone researching this specific topic

An item is NOT relevant if:
- It only tangentially mentions or uses the topic as a tool/component
- It's about a completely different subject
- The connection to the topic is incidental or peripheral

Items to evaluate:
${itemsList}

Respond with ONLY a JSON object in this exact format:
{"relevant": ["id1", "id2", ...], "not_relevant": ["id3", "id4", ...]}

Include ALL item IDs in your response, categorized as either relevant or not_relevant.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`[Relevance Filter] Failed to parse response for ${itemType}, keeping all items`)
      return { kept: items.map(i => i.id), removed: [] }
    }

    const parsed = JSON.parse(jsonMatch[0]) as { relevant: string[], not_relevant: string[] }

    return {
      kept: parsed.relevant || [],
      removed: parsed.not_relevant || [],
    }
  } catch (error) {
    console.error(`[Relevance Filter] Error filtering ${itemType}:`, error)
    // On error, keep all items rather than losing data
    return { kept: items.map(i => i.id), removed: [] }
  }
}

// -----------------------------------------------------------------------
// Trial + patent batched relevance filter with 3-way verdicts.
// Motivation from r18 audit:
//   - Trial "Circulating Cancer Cells in Metastatic Breast" (NCT00898781)
//     pulled into a "liquid biopsy for EARLY cancer detection" report
//     because it links to a topic-relevant NIH project. Metastatic
//     monitoring != early detection.
//   - Patent 10556956 "Methods of Mediating Cytokine Expression" linked
//     to an ovarian biomarker project — the project matches the topic,
//     the patent is T-cell immunology.
// A binary relevant/not-relevant kicks too many borderline items out.
// The tangential middle bucket keeps borderline items visible (they
// still tell the reader "the field's neighboring work"), while
// "unrelated" is dropped so the pipeline doesn't look larger than it is.
// -----------------------------------------------------------------------

export type RelevanceVerdict = 'relevant' | 'tangential' | 'unrelated'

interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

export interface TrialWithVerdict extends TrialItem {
  topicalRelevance: RelevanceVerdict
}
export interface PatentWithVerdict extends PatentItem {
  topicalRelevance: RelevanceVerdict
}

/**
 * Batch-judge topical relevance for trials + patents in a single LLM
 * call. Returns items sorted (relevant → tangential); "unrelated" are
 * dropped from the returned arrays but reflected in the excluded count.
 * Total item counts + phase/assignee breakdowns in agent_outputs stay
 * untouched — this only reshuffles / trims the item lists rendered to
 * the reader.
 */
export async function filterTrialsAndPatentsByRelevance(
  topic: string,
  trials: TrialItem[],
  patents: PatentItem[],
  usageTracker: UsageTracker,
): Promise<{
  trials: TrialWithVerdict[]
  patents: PatentWithVerdict[]
  trialsExcluded: number
  patentsExcluded: number
}> {
  if (trials.length === 0 && patents.length === 0) {
    return { trials: [], patents: [], trialsExcluded: 0, patentsExcluded: 0 }
  }

  const trialLines = trials.map((t, i) => {
    const conditions = t.conditions?.slice(0, 4).join(', ') || ''
    return `T${i + 1} | ${t.nct_id} | ${t.study_title || '(untitled)'}${conditions ? ' | conditions: ' + conditions : ''}`
  })
  const patentLines = patents.map((p, i) => {
    const abstractExcerpt = (p.patent_abstract || '').slice(0, 200).replace(/\n/g, ' ')
    return `P${i + 1} | ${p.patent_id} | ${p.patent_title || '(untitled)'}${abstractExcerpt ? ' | abstract: ' + abstractExcerpt : ''}`
  })

  const prompt = `Report topic: "${topic}"

The clinical trials and patents below were retrieved as candidates for this topic report. They came in via NIH project_number linkages (a topic-relevant project acknowledged them) OR semantic similarity to the topic. Some are directly about the topic; some are only tangentially related (e.g., the same lab that studies liquid biopsy also filed a patent on T-cell regulation, which links via the project but isn't about the topic).

Judge each item's topical relevance:
- "relevant": directly about the topic. Include cases where the topic is one of multiple named applications.
- "tangential": touches the topic loosely or shares infrastructure/context (same disease area, same lab, adjacent methodology) but isn't primarily about the topic.
- "unrelated": off-topic despite the linkage — e.g., a T-cell mediation patent from a lab that also does liquid biopsy, or a metastatic-monitoring trial for an EARLY-detection topic.

Be strict but not overzealous. When in doubt between relevant/tangential, prefer tangential. When in doubt between tangential/unrelated, prefer tangential — only mark "unrelated" when the item is clearly about a different subject than the topic.

## TRIALS (${trials.length})
${trialLines.join('\n')}

## PATENTS (${patents.length})
${patentLines.join('\n')}

Return JSON only. One verdict per item; use the exact ID (NCT_ID for trials, patent_id for patents).

{
  "trialVerdicts": [
    { "id": "NCT06962995", "verdict": "relevant" }
  ],
  "patentVerdicts": [
    { "id": "10556956", "verdict": "unrelated" }
  ]
}`

  const verdictMap = new Map<string, RelevanceVerdict>()

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (text && text.type === 'text') {
      let raw = text.text.trim()
      if (raw.startsWith('```')) {
        raw = raw.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
      }
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        for (const v of parsed.trialVerdicts || []) {
          if (v?.id && isVerdict(v.verdict)) verdictMap.set(v.id, v.verdict)
        }
        for (const v of parsed.patentVerdicts || []) {
          if (v?.id && isVerdict(v.verdict)) verdictMap.set(v.id, v.verdict)
        }
      }
    }
  } catch (err) {
    console.error('[Relevance Filter] LLM call failed, keeping all items:', err)
    // Fail open — mark everything as relevant so we don't lose the section.
  }

  const trialsAnnotated: TrialWithVerdict[] = trials.map((t) => ({
    ...t,
    topicalRelevance: verdictMap.get(t.nct_id) || 'relevant',
  }))
  const patentsAnnotated: PatentWithVerdict[] = patents.map((p) => ({
    ...p,
    topicalRelevance: verdictMap.get(p.patent_id) || 'relevant',
  }))

  const trialsKept = trialsAnnotated
    .filter((t) => t.topicalRelevance !== 'unrelated')
    .sort((a, b) => verdictSortKey(a.topicalRelevance) - verdictSortKey(b.topicalRelevance))
  const patentsKept = patentsAnnotated
    .filter((p) => p.topicalRelevance !== 'unrelated')
    .sort((a, b) => verdictSortKey(a.topicalRelevance) - verdictSortKey(b.topicalRelevance))

  const trialsExcluded = trials.length - trialsKept.length
  const patentsExcluded = patents.length - patentsKept.length

  if (trialsExcluded > 0 || patentsExcluded > 0) {
    console.log(
      `[Relevance Filter] Excluded ${trialsExcluded}/${trials.length} trials and ${patentsExcluded}/${patents.length} patents as topically unrelated.`,
    )
  }

  return {
    trials: trialsKept,
    patents: patentsKept,
    trialsExcluded,
    patentsExcluded,
  }
}

function isVerdict(v: unknown): v is RelevanceVerdict {
  return v === 'relevant' || v === 'tangential' || v === 'unrelated'
}

function verdictSortKey(v: RelevanceVerdict): number {
  return v === 'relevant' ? 0 : v === 'tangential' ? 1 : 2
}

/**
 * Quick relevance check using keyword matching
 * Use this for pre-filtering before AI-based filtering to reduce costs
 * Returns true if the item likely relates to the topic
 */
export function quickRelevanceCheck(topic: string, title: string, description?: string | null): boolean {
  const topicLower = topic.toLowerCase()
  const textToCheck = `${title} ${description || ''}`.toLowerCase()

  // Extract key terms from the topic
  const topicWords = topicLower
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['and', 'the', 'for', 'with', 'from'].includes(w))

  // Check if any topic words appear in the text
  const matchCount = topicWords.filter(word => textToCheck.includes(word)).length

  // Require at least 40% of topic words to match
  return matchCount >= Math.ceil(topicWords.length * 0.4)
}
