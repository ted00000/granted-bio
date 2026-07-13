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
  'no-prescriptive-adjacent-to-named-orgs',

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
  'no-cluster-in-patent-when-insufficient',
  'no-negation-shape-claims-insufficient-sample',
  'white-space-si-ranked-only',
  'no-unsupported-causal-attribution',

  // Arithmetic + logic:
  'gap-signal-share-normalized',
  'no-nonexclusive-share-double-count',
  'trial-status-arithmetic-reconciles',
  'trial-status-sum-reconciles',
  'trial-status-enumeration-complete',
  'trial-status-reconciles-across-sections',
  'no-active-or-completed-bucket',
  'no-overlapping-status-subtotals',
  'no-orphan-trial-denominator',
  'terminations-count-label-mismatch',
  'no-phase-labeled-interventional-subset',
  'no-phase-labeled-interventional-collapse',
  'no-sample-total-as-category',

  // Small-sample framing:
  'surprising-findings-need-confidence-tag',

  // Named-product two-sided requirement:
  'named-product-single-sided',
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
// Per-rule extra guidance. r47 audit: retry corrections were swapping one
// banned word for another ("distributed across" → "consolidated"). Give
// Sonnet the full banned family per rule so it can avoid the trap.
const RULE_EXTRA_GUIDANCE: Record<string, string> = {
  'no-ip-shape-words-insufficient-sample': `IP-shape-word ban family: **all** of these are forbidden when patents < 10, not just the specific token flagged — do not swap one for another. Forbidden shape words: "fragmented", "concentrated", "moderately concentrated", "highly concentrated", "consolidated", "consolidat", "converged", "converging", "cluster around", "clustered", "clustering", "distributed across", "spread across", "held across ... rather than", "diverse landscape", "wide range of". Also forbidden as verbs: "concentrate on", "cluster around", "consolidate around". Replacements: describe the sample as a factual list ("the ${'${totalPatents}'} linked patents span N assignees across the following technical areas: ...") or use neutral verbs like "cover", "focus on", "address", "span".`,
  'ip-concentration-consistency': `Same ban family as no-ip-shape-words-insufficient-sample. Any concentrat/fragment/consolidat token in an IP-context sentence when patents < 10 contradicts the Patent section's insufficient-sample stance.`,
  'no-ip-breadth-claims-insufficient-sample': `IP breadth/convergence claims are banned when patents < 10 — including "rather than converging", "converging on", "converge around", "wide range of", "diverse methods", "breadth of approaches", "multiple independent approaches rather than", "pursued across multiple", "diverse but institutionally", "diverse landscape". Sonnet often swaps a banned shape word (concentrated/consolidated) FOR one of these breadth words when correcting — do NOT do this. r49 audit caught "rather than converging" replacing a "concentrat" edit. Replacements: describe what's actually in the sample as a factual enumeration ("the ${'${totalPatents}'} linked patents include: isothermal amplification, electrochemical biosensing, ..."). No breadth interpretation.`,
  'named-product-single-sided': `When you mention a named clinical product (Galleri, Shield, DELFI, PATHFINDER, NHS-Galleri, Signatera, Cologuard, Freenome, etc), either (a) cite BOTH a positive fact AND a specificity/PPV/coverage/reimbursement/endpoint-miss concern in the SAME sentence, or (b) restrict the mention to a purely factual description with no positive framing at all ("approved", "breakthrough", "leading", "validated", "state-of-the-art", "first-in-class" are all positive framing). Do NOT just delete the product name — the reader knows the product exists.`,
  'trial-status-arithmetic-reconciles': `If you cite ANY status counts (recruiting, terminated, etc.) the cited counts MUST sum to the total. Prefer the compact form "N in-progress/planned/completed vs M terminated/suspended/withdrawn (T total)". If you itemize, include EVERY non-zero status so counts sum exactly to the total.`,
  'trial-status-sum-reconciles': `If you cite ANY status counts the cited counts MUST sum to the total. Use the compact form or include every non-zero status.`,
  'trial-status-enumeration-complete': `**STRONGLY PREFERRED: use the compact form.** Do NOT partially enumerate a few statuses (e.g. "10 terminated and 2 suspended trials in the sample are a substantive signal") — this leaves 57 of 69 trials unattributed and trips the linter. Replace with either:\n(a) COMPACT FORM: "57 trials in progress, planned, or completed vs 12 terminated/suspended/withdrawn (69 total)" — this sums exactly and is unambiguous. USE THIS.\n(b) OR describe the terminated/suspended signal qualitatively WITHOUT the count enumeration: "some terminated and suspended trials in the sample are a substantive signal..." — no numbers.\nIf you must itemize, list EVERY non-zero status: Recruiting, Active-not-recruiting, Enrolling-by-invitation, Completed, Not-yet-recruiting, Terminated, Suspended, Withdrawn — with counts summing to the total.`,
  'no-sample-share-to-structural': `A sample percentage cannot be used to claim a field-level "structural" gap. "5% of projects" is a sample observation, not a claim about field-wide underinvestment. Rewrite as "within the analyzed sample, X represents a low share" — do not extend to "the field is underfunded".`,
  'no-pi-names-in-narrative': `Remove the PI name entirely. Do not replace with "Dr. X's group" or "the X lab" — those are equivalent violations.`,
  'no-institutions-as-entry-points': `Institution names are fine as factual attribution ("2 patents at Johns Hopkins") but NOT as action anchors ("engage Johns Hopkins", "start with the Johns Hopkins node"). Rewrite as method-anchored: "start with the [technical method] present in this sample".`,
  'no-active-or-completed-bucket': `The phrase "N trials are active or completed" is banned — readers disagree on whether "recruiting" counts as "active". Use the compact form "N in-progress/planned/completed vs M terminated/suspended/withdrawn (T total)" OR itemize each non-zero status.`,
  'no-overlapping-status-subtotals': `Do NOT cite two overlapping subtotals of the same base in the same passage. Example ban: "15 terminated/suspended/withdrawn (69 total)... terminated and suspended trials (12 combined)". Pick ONE framing (either "15 T/S/W" or "10 T + 2 S + 3 W" itemized) and stay with it.`,
  'no-orphan-trial-denominator': `You cited a trial-count denominator that doesn't map to any subset in the data. Only cite counts that appear in the underlying trials data: total, observational, interventional, phase-labeled counts, or specific status counts. Do NOT invent subsets ("25 reviewed trials" when the sample has 69) — the linter has the full count set and will catch it.`,
  'no-forward-will-absolutes': `Bare future-tense absolutes are banned: "will pressure", "will force", "will drive", "will require", "will shift", "will accelerate", "will increase". Rewrite with modal hedges: "is likely to pressure", "may drive", "could shift", "creates pressure for".`,
  'no-sample-total-as-category': `When you cite a sample-total figure ($100.9M or 123 projects) alongside a category name, you MUST attach the category's own count in "(N of TOTAL)" or "N%" form. WRONG: "$100.9M across 123 projects, concentrated in diagnostics". RIGHT: "diagnostics account for 60.2% of projects (74 of 123)" or "the diagnostics funding category (74 of 123, 60.2%)".`,
  'trial-status-reconciles-across-sections': `Cite the trial-status split consistently across sections. If Exec Summary says "N active/completed", other sections that cite the same split must use the same N and definition. Preferred: compact form "N in-progress/planned/completed vs M terminated/suspended/withdrawn (T total)".`,
  'no-cluster-in-patent-when-insufficient': `Same ban family as no-ip-shape-words-insufficient-sample. "Cluster around", "clustered", "clustering", "cluster of" — all banned when patents < 10 in the Patent Activity section.`,
  'no-negation-shape-claims-insufficient-sample': `Negation of a shape claim is still a shape claim. "No single institution holds a dominant share" implies a distribution shape can be observed. When patents < 10, do NOT write negation shape claims either. Describe the sample as a factual enumeration.`,
  'no-prescriptive-adjacent-to-named-orgs': `Naming institutions in factual concentration is fine ("Johns Hopkins holds 3 patents"). But do NOT pair a named institution with prescriptive framing in the SAME sentence: "differentiation space", "crowded for entrants", "opportunity for entrants to", "entry points lie", "target the differentiation". Split into two sentences: one factual, one strategic without the institution name.`,
}

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
      const extra = RULE_EXTRA_GUIDANCE[v.ruleId]
      if (extra) entry += `\n   Extra guidance: ${extra}`
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
// r47 audit: previous budget (60s total, 45s per-call) was too tight for
// 3 parallel sections. Patent Activity got aborted at 60002ms while Next
// Steps + Research Positioning finished at 12.6s / 14.7s. Vercel Pro caps
// at 900s and base synthesis runs ~180-240s, so raising the retry ceiling
// still leaves comfortable headroom.
const PER_CALL_TIMEOUT_MS = 90_000
const TOTAL_BUDGET_MS = 150_000

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
