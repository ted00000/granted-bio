/**
 * Lint-driven auto-retry: after the report is assembled and the linter
 * flags critical violations, extract the offending sections and ask
 * Claude to rewrite them without the violations. Splice the corrected
 * text back into the markdown.
 *
 * Design decisions:
 *
 * 1. **Section-scoped, not whole-document.** We extract each violating
 *    section (identified by `## Heading` boundaries) and send only that
 *    slice to the LLM. Cheaper, safer, less risk of unintended edits
 *    elsewhere. Sonnet's max_tokens caps a whole-document rewrite anyway.
 *
 * 2. **One retry pass max.** If violations remain after retry, log and
 *    ship. Better than infinite loop risk.
 *
 * 3. **Retry-eligible violations only.** Not every rule benefits from
 *    LLM regen. Em dashes, "genuine [noun]", and "underscore" are already
 *    fixed by deterministic post-render substitution — no LLM needed.
 *    Only violations that require the LLM to reconstruct the sentence
 *    are eligible (PI possessive that slipped past strip, institutional
 *    targeting, sample-share-to-structural, sub-30 category naming).
 *
 * 4. **Body-wide violations (section=null) are skipped** for retry.
 *    Those get fixed by other layers (post-render substitution) or ship
 *    as warnings if they slipped through.
 *
 * Expected cost per retry: 1 LLM call per violating section, ~2-4k input
 * tokens + ~1-2k output tokens. Roughly $0.05-0.10 per fired retry.
 * Typical retry rounds fire 0-3 sections, so worst case adds ~$0.30 to
 * a $0.85 report.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LintViolation } from './lint-report'
import { normalizeConfidenceTagSpacing } from './confidence-tags'
import { sanitizeText } from './sanitize'
import { applyPostRenderSubstitutions } from './post-render'

const MODEL = 'claude-sonnet-4-6'

// Only these rules benefit from LLM regen. All others are either
// already fixed by post-render substitution or shouldn't force a
// retry (warnings, deterministic issues).
const RETRY_ELIGIBLE_RULES = new Set<string>([
  // Callout etiquette that requires sentence-level rewrite:
  'no-pi-names-in-narrative',
  'no-pi-possessive-in-narrative',
  'no-institutions-as-entry-points',
  'no-prescriptive-set-targeting',
  'no-prescriptive-org-targeting',

  // Field-level absolutes that need rephrasing (not just word swap):
  'no-field-level-absolutes',
  'no-sample-share-to-structural',
  'no-two-point-trend-absolutes',
  'two-point-trend-hedge-required',
  'no-forward-will-absolutes',

  // Interpretive claims that need reasoning:
  'ip-concentration-consistency',
  'no-ip-shape-words-insufficient-sample',
  'no-ip-breadth-claims-insufficient-sample',
  'white-space-si-ranked-only',
  'no-unsupported-causal-attribution',

  // Arithmetic + logic:
  'gap-signal-share-normalized',
  'no-nonexclusive-share-double-count',
  'trial-status-arithmetic-reconciles',
  'trial-status-sum-reconciles',
  'terminations-count-label-mismatch',
  'no-phase-labeled-interventional-subset',

  // Small-sample framing:
  'surprising-findings-need-confidence-tag',
])

// Rules NOT worth retrying — they're either deterministically fixed
// elsewhere or too noisy to force a regen. Kept as an explicit set
// so we can reason about coverage.
const DETERMINISTIC_FIX_RULES = new Set<string>([
  'no-banned-ai-tell-phrases', // post-render substitution handles these
  'no-em-dashes', // post-render substitution
  'no-inline-confidence-tags', // normalizeConfidenceTagSpacing
  'no-gibberish', // sanitizeText upstream
])

interface SectionCorrection {
  sectionName: string
  violations: LintViolation[]
  extractedText: string
}

/**
 * Extract sections from markdown by `## Heading` boundaries. Returns
 * a Map of section name -> full section text (including the heading
 * line and everything up to the next `## Heading` or EOF).
 */
function extractSections(markdown: string): Map<string, { text: string; startIdx: number; endIdx: number }> {
  const sections = new Map<string, { text: string; startIdx: number; endIdx: number }>()
  const lines = markdown.split('\n')
  let currentHeading: string | null = null
  let currentStartLine = 0
  let currentLines: string[] = []
  let charOffset = 0
  const lineStartOffsets: number[] = [0]
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets.push(lineStartOffsets[i] + lines[i].length + 1)
  }

  const flush = (endLine: number) => {
    if (currentHeading !== null) {
      const startIdx = lineStartOffsets[currentStartLine]
      const endIdx = lineStartOffsets[endLine]
      sections.set(currentHeading, {
        text: currentLines.join('\n'),
        startIdx,
        endIdx,
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      flush(i)
      currentHeading = match[1].trim()
      currentStartLine = i
      currentLines = [line]
    } else if (currentHeading !== null) {
      currentLines.push(line)
    }
    charOffset += line.length + 1
  }
  flush(lines.length)
  return sections
}

/**
 * Group retry-eligible violations by section name. Violations with no
 * section (body-wide) are dropped from the retry set.
 */
function groupBySection(
  violations: LintViolation[],
): Map<string, LintViolation[]> {
  const grouped = new Map<string, LintViolation[]>()
  for (const v of violations) {
    if (v.severity !== 'critical') continue
    if (!RETRY_ELIGIBLE_RULES.has(v.ruleId)) continue
    if (!v.section) continue
    // The section field can be "Section Name" or "Section Name → Subsection"
    // or "Strategic Implications block #N". Normalize to the top-level
    // heading when possible.
    let sectionKey = v.section
    // Strip subsection arrows.
    sectionKey = sectionKey.replace(/\s*→.*$/, '').replace(/\s*->.*$/, '')
    // "Strategic Implications block #N" doesn't have a top-level heading
    // we can locate deterministically - skip those (they'd need per-
    // block correction which is more infrastructure than v1 warrants).
    if (/Strategic Implications block/i.test(sectionKey)) continue
    // "White Space: Cancer Type" -> "White Space Analysis"
    if (sectionKey.startsWith('White Space:')) sectionKey = 'White Space Analysis'
    const existing = grouped.get(sectionKey) || []
    existing.push(v)
    grouped.set(sectionKey, existing)
  }
  return grouped
}

/**
 * Build a correction prompt that describes the violations and asks the
 * LLM to rewrite the section text without them. Returns the correction
 * prompt.
 */
function buildCorrectionPrompt(
  sectionName: string,
  sectionText: string,
  violations: LintViolation[],
  topic: string,
): string {
  const violationList = violations
    .map((v, i) => {
      let entry = `${i + 1}. [${v.ruleId}] ${v.message}`
      if (v.offending) entry += `\n   Offending text/phrase: "${v.offending}"`
      return entry
    })
    .join('\n\n')

  return `You are correcting a specific section of an intelligence report on "${topic}". A deterministic linter flagged the following violations in this section and only in this section - rewrite the section to eliminate every one of them while preserving all other content (structure, numbers, tables, links, other prose).

## VIOLATIONS TO FIX (all must be addressed)

${violationList}

## SECTION TEXT (rewrite this)

${sectionText}

## OUTPUT INSTRUCTIONS

- Return the CORRECTED section text ONLY, starting with the section's ## heading, with no wrapper, no preamble, no explanation, no code fence, no "Here is the corrected section:" line.
- Preserve ALL tables verbatim (do not touch table cells or their arithmetic).
- Preserve ALL markdown structure (headings, bullets, blockquotes, italic/bold, links).
- Preserve ALL numeric claims that were not flagged as violations.
- Preserve every Confidence + Evidence tag that was already present (it may already be correct).
- Do NOT add em dashes; use regular hyphens.
- Do NOT introduce new violations of the rules listed above.
- If a violation is impossible to correct without removing content, drop the offending sentence entirely rather than paraphrasing around it.

Return the rewritten section text only.`
}

/**
 * Splice a corrected section back into the full markdown by locating
 * its heading and replacing the byte range.
 */
function spliceSection(
  markdown: string,
  sectionName: string,
  correctedText: string,
  sections: Map<string, { text: string; startIdx: number; endIdx: number }>,
): string {
  const target = sections.get(sectionName)
  if (!target) return markdown
  return markdown.slice(0, target.startIdx) + correctedText + '\n' + markdown.slice(target.endIdx)
}

interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

/**
 * Public entry point. Returns the corrected markdown (or the original
 * if no retries fired or all attempts failed). Never throws — retry
 * failures degrade to log-and-ship.
 *
 * Time budget (r38 rewrite): the previous version used Promise.race
 * against a setTimeout to enforce a wall-clock budget, but Promise.race
 * doesn't CANCEL the losing promise — the Anthropic requests kept
 * running past the budget and stalled synthesis past Vercel's 300s
 * ceiling. Two reports (e8df0ae0, 6b9ba9f8) hit that ceiling.
 *
 * The fix in this version:
 *   1. Every LLM call gets an AbortController whose signal is passed
 *      into client.messages.create via the SDK's `signal` option.
 *   2. A single wall-clock timer fires abort() on every outstanding
 *      controller at TOTAL_BUDGET_MS. This actually cancels the
 *      underlying fetch requests, so wall-clock cannot exceed
 *      TOTAL_BUDGET_MS + a small teardown grace.
 *   3. Tighter budget: 60s (was 90s). Base synthesis runs ~180-240s,
 *      so a 60s retry ceiling keeps total under ~300s with margin.
 */
const PER_CALL_TIMEOUT_MS = 45_000
const TOTAL_BUDGET_MS = 60_000

export async function applyLintCorrections(
  markdown: string,
  violations: LintViolation[],
  topic: string,
  usageTracker: UsageTracker,
): Promise<string> {
  const grouped = groupBySection(violations)
  if (grouped.size === 0) return markdown
  console.log(
    `[Lint Retry] ${grouped.size} section(s) with retry-eligible critical violation(s): ${Array.from(grouped.keys()).join(', ')}`,
  )

  const client = new Anthropic()
  const sections = extractSections(markdown)
  const startedAt = Date.now()

  // Run all section corrections in parallel. Each gets its own
  // AbortController; the global timer aborts all of them at
  // TOTAL_BUDGET_MS so a stuck request cannot outlast the budget.
  interface CorrectionResult {
    sectionName: string
    corrected: string | null
    violationCount: number
    elapsedMs: number
  }

  const controllers: AbortController[] = []
  const correctionTasks: Promise<CorrectionResult>[] = []
  for (const [sectionName, sectionViolations] of grouped) {
    const target = sections.get(sectionName)
    if (!target) {
      console.warn(
        `[Lint Retry] Could not locate section "${sectionName}" - skipping ${sectionViolations.length} violation(s)`,
      )
      continue
    }
    if (target.text.length < 100) {
      console.warn(
        `[Lint Retry] Section "${sectionName}" is too short (${target.text.length} chars) - skipping`,
      )
      continue
    }
    const controller = new AbortController()
    controllers.push(controller)
    correctionTasks.push(
      correctOneSection(
        client,
        sectionName,
        target.text,
        sectionViolations,
        topic,
        usageTracker,
        controller,
      ),
    )
  }

  if (correctionTasks.length === 0) return markdown

  // Wall-clock enforcement. When the timer fires we abort every
  // outstanding controller AND resolve the race with the partial
  // results. This actually cancels the underlying fetch requests
  // (unlike Promise.race alone, which just abandons them).
  let budgetHit = false
  const budgetTimer = setTimeout(() => {
    budgetHit = true
    console.warn(
      `[Lint Retry] Wall-clock budget of ${TOTAL_BUDGET_MS}ms hit - aborting ${controllers.length} outstanding request(s)`,
    )
    for (const c of controllers) c.abort()
  }, TOTAL_BUDGET_MS)

  let results: CorrectionResult[]
  try {
    results = await Promise.all(correctionTasks)
  } finally {
    clearTimeout(budgetTimer)
  }
  const elapsed = Date.now() - startedAt
  const succeeded = results.filter((r) => r.corrected !== null).length
  console.log(
    `[Lint Retry] Correction batch finished in ${elapsed}ms - ${succeeded}/${results.length} succeeded${budgetHit ? ' (budget hit)' : ''}`,
  )

  // Splice corrected sections back. Do this against a fresh
  // extractSections read so offsets stay valid as we mutate.
  let current = markdown
  for (const r of results) {
    if (!r || !r.corrected) continue
    const currentSections = extractSections(current)
    current = spliceSection(current, r.sectionName, r.corrected, currentSections)
  }
  return current
}

/**
 * Correct a single section. Returns the corrected text or null if the
 * correction failed / was rejected / timed out / was aborted.
 *
 * Timing:
 *   - Per-call SDK timeout is PER_CALL_TIMEOUT_MS (SDK-level abort).
 *   - The wall-clock budget aborts via the passed-in controller.
 *   - Either mechanism produces a caught abort error that returns null.
 */
async function correctOneSection(
  client: Anthropic,
  sectionName: string,
  sectionText: string,
  sectionViolations: LintViolation[],
  topic: string,
  usageTracker: UsageTracker,
  controller: AbortController,
): Promise<{ sectionName: string; corrected: string | null; violationCount: number; elapsedMs: number }> {
  const startedAt = Date.now()
  const prompt = buildCorrectionPrompt(sectionName, sectionText, sectionViolations, topic)
  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: Math.min(8000, Math.max(2000, Math.floor(sectionText.length / 3))),
        messages: [{ role: 'user', content: prompt }],
      },
      {
        signal: controller.signal,
        timeout: PER_CALL_TIMEOUT_MS,
      },
    )
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens
    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') {
      console.warn(`[Lint Retry] No text response for section "${sectionName}"`)
      return { sectionName, corrected: null, violationCount: sectionViolations.length, elapsedMs: Date.now() - startedAt }
    }
    let corrected = text.text.trim()
    if (corrected.startsWith('```')) {
      corrected = corrected
        .replace(/^```(?:markdown)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim()
    }
    // Apply the same post-render substitutions the initial assemble
    // pass runs, so the retry doesn't reintroduce em dashes, "genuine
    // [noun]", or other banned tokens. r40 audit found em dashes
    // pervasive after retry because these substitutions only ran in
    // assembleMarkdown - not on retry-corrected sections.
    corrected = applyPostRenderSubstitutions(corrected)
    corrected = normalizeConfidenceTagSpacing(sanitizeText(corrected, `retry:${sectionName}`))
    if (!corrected || corrected.length < 100) {
      console.warn(
        `[Lint Retry] Correction for "${sectionName}" was empty or too short (${corrected.length} chars). Keeping original.`,
      )
      return { sectionName, corrected: null, violationCount: sectionViolations.length, elapsedMs: Date.now() - startedAt }
    }
    if (!corrected.startsWith(`## ${sectionName}`)) {
      corrected = `## ${sectionName}\n\n${corrected}`
    }
    const elapsedMs = Date.now() - startedAt
    console.log(
      `[Lint Retry] Corrected "${sectionName}" in ${elapsedMs}ms - ${sectionViolations.length} violation(s) addressed`,
    )
    return { sectionName, corrected, violationCount: sectionViolations.length, elapsedMs }
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    const isAbort =
      (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) ||
      controller.signal.aborted
    if (isAbort) {
      console.warn(`[Lint Retry] Correction for "${sectionName}" aborted after ${elapsedMs}ms (budget/timeout)`)
    } else {
      console.warn(`[Lint Retry] Correction for "${sectionName}" failed after ${elapsedMs}ms:`, err)
    }
    return { sectionName, corrected: null, violationCount: sectionViolations.length, elapsedMs }
  }
}
