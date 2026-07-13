/**
 * Opus audit-agent: an LLM reviewer that runs the same rubric an
 * external Opus audit would apply, then produces targeted corrections
 * we can splice back into the markdown.
 *
 * Why this exists: the deterministic linter + Sonnet retry pass catches
 * ~15 classes of violation reliably, but every external audit round
 * (~14 rounds by r43) surfaced 4-5 new semantic phrasings the regex
 * linter couldn't catch. This module is the second retry pass — a
 * semantic reviewer for what the regex linter misses.
 *
 * Cost: ~$0.83 per fired retry (Opus 4.7: ~30K input + 5K output).
 * Gate behind AUDIT_AGENT_ENABLED env flag so the user controls when
 * it runs; default OFF.
 *
 * Runs INSIDE the phase-4 synthesis step (which has a 900s Vercel Pro
 * budget), AFTER lint-retry. Opus call typically completes in 30-90s.
 */

import Anthropic from '@anthropic-ai/sdk'
import { normalizeConfidenceTagSpacing } from './confidence-tags'
import { sanitizeText } from './sanitize'
import { applyPostRenderSubstitutions } from './post-render'

// Opus 4.7 is the strongest available Claude — worth the cost for
// semantic pattern matching the regex linter misses.
const MODEL = 'claude-opus-4-7'
const CALL_TIMEOUT_MS = 120_000 // 2 min hard cap per call

interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

interface AuditCorrection {
  dimension: string
  severity: 'critical' | 'warning'
  offendingText: string
  correctedText: string
  explanation: string
}

const RUBRIC = `# granted.bio Report Audit Rubric

You are auditing a paid intelligence report ($199 product) on a life-sciences research topic. Your job: read as a skeptical domain expert would, identify violations of the 11-dimension rubric below, and produce targeted corrections that fix each violation via string replacement.

## 11 dimensions

**1. Factual / quantitative rigor.** Every percentage must match the exact figure in a table. Small-N claims (<=2 projects/patents) must carry a hedge. No forward-looking absolutes ("the field is accelerating") from short trend windows. Numbers reconcile across sections — if Exec Summary says 65 trials and Clinical Validation shows 65, the status counts summed in prose must equal 65. Sample-total figures ($100.9M / 123 projects) are NOT category subtotals; Diagnostics is its own smaller number.

**2. Clinical-result honesty.** When a named clinical program or product is cited (GRAIL Galleri, DELFI, EFIRM, MRDetect, Vanguard, Signatera, Shield, Freenome, PATHFINDER 2, NHS-Galleri), you MUST present both positive AND negative readouts in the same paragraph. Single-sided framing on a mixed-result program is a fail.

**3. Sample-based language / NIH-linked scope.** Claims about the field must acknowledge the NIH-linked scope where it materially affects the reading. BANNED constructions: "clear gap", "structural underfunding", "will pressure/force/drive/require", "sparse relative to translational volume", "mechanistic gap may constrain", "field faces". A sample share % cannot be used to argue a field-wide "structural" or "underfunded" claim, even with hedges like "suggesting" or "may".

**4. Confidence + Evidence tags.** Every substantive interpretive claim in Field Maturity, Competitive Topology, IP Landscape, White Space, and Strategic Implications must carry a **Confidence: High/Medium/Low** tag with a concrete Evidence line, on its own line (blank line before).

**5. Callout etiquette (descriptive vs prescriptive).** Institution names are FINE for factual concentration ("methylation concentrates at UCLA, JH, Stanford"). NOT FINE when adjacent to prescriptive framing in the same sentence — "Johns Hopkins, UCLA, Stanford ... compressing differentiation space for new entrants" pairs a factual list with a strategic recommendation and reads as targeting those institutions. Also NOT FINE: "hub"/"entry point"/"access node" near org names; "collaboration target"/"partnership target" anywhere; "cross-pollination"/"creates conditions where X is plausible" tied to a named org; possessive PI references ("Velculescu's DELFI work") in any narrative field.

**6. What Surprised Us — aggregate patterns only.** Every finding pattern-level ("N publication-active orgs show no downstream IP linkage"), never named ("UCLA publishes but has no patents"). Zero named institutions or PIs in this section.

**7. Taxonomy source discipline.** Two taxonomies exist: funding category (Diagnostics, Basic Research, Biotools, etc.) and White Space dimension categories (Biomarker Discovery, Methodology Platform, etc.). When citing counts, name the source. Don't invoke the same conceptual gap ("mechanistic") with different counts from both taxonomies in the same paragraph without disambiguation.

**8. IP concentration consistency.** When linked patents < 10, the Patent section header must say "Insufficient sample to characterize". No shape/distribution claims anywhere in Patent Activity / Research Positioning / Next Steps sections — this includes negations like "no single institution holds a dominant share", "not dominated by X", "fairly even distribution". Cite raw counts only. No percentages on the patent base.

**9. White Space validity.** Coverage Gap Signals must be share-normalized (broader-share vs sample-share ratio), not raw count ratios. Categories below the 30 broader-NIH floor should not appear as ranked gaps. Sub-30 categories should not be surfaced as opportunities in Strategic Implications. Dagger cells >=5x median or matching generic-term list. Small-sample caveats when sampleCount <= 1.

**10. Prose quality.** No em dashes (product convention: hyphens). No AI-tell phrases: "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "genuine [noun]" pattern, "perhaps most critically". No wall-of-text paragraphs.

**11. Date integrity.** YYYY-MM prefixes on Market Context bullets must match the actual event date in the description. Cross-section date consistency for the same named event.

## Your output

For every violation you find, produce a JSON object with:
- **dimension**: which numbered dimension it violates (1-11)
- **severity**: "critical" if it would embarrass the report with a domain expert, "warning" otherwise
- **offendingText**: the EXACT substring from the markdown that must be replaced (verbatim; whitespace, punctuation, everything). Must be unique enough to find with a string search. Keep it under 400 chars. If the offense spans a whole paragraph, include the whole paragraph.
- **correctedText**: the replacement text that fixes the violation while preserving all other content, numeric claims, Confidence tags, and prose structure. Use the same length ballpark as the offending text; do not truncate context.
- **explanation**: one sentence on why this is a violation.

Return valid JSON only:

\`\`\`
{
  "violations": [
    { "dimension": "5", "severity": "critical", "offendingText": "...", "correctedText": "...", "explanation": "..." },
    ...
  ]
}
\`\`\`

Rules for corrections:
1. Preserve ALL numeric claims that aren't the violation itself.
2. Preserve ALL Confidence + Evidence tags.
3. Preserve ALL markdown structure (headings, tables, bullets, links).
4. Do NOT introduce new violations of any dimension.
5. Do NOT invent facts. If a violation requires information not present, drop the offending clause instead of paraphrasing around it.
6. offendingText MUST appear verbatim in the markdown — copy the substring exactly, do not summarize.
7. If a violation has no clean fix (structural issue, missing section), report it with correctedText = "" and severity=warning.
8. Be tight: aim for surgical single-sentence corrections when possible.

If you find zero violations, return { "violations": [] }.`

/**
 * Public entry point. Runs the Opus audit-agent against the assembled
 * markdown, applies corrections via string replacement, returns the
 * corrected markdown. Never throws — audit failures degrade to
 * log-and-ship.
 */
export async function runAuditAgent(
  markdown: string,
  topic: string,
  usageTracker: UsageTracker,
): Promise<{ markdown: string; violationsFound: number; violationsApplied: number }> {
  const client = new Anthropic()
  const startedAt = Date.now()

  try {
    const prompt = `${RUBRIC}\n\n## TOPIC\n\n${topic}\n\n## REPORT MARKDOWN\n\n${markdown}`
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: CALL_TIMEOUT_MS },
    )
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') {
      console.warn('[Audit Agent] No text response from Opus')
      return { markdown, violationsFound: 0, violationsApplied: 0 }
    }

    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Audit Agent] No JSON in Opus response')
      return { markdown, violationsFound: 0, violationsApplied: 0 }
    }

    const parsed = JSON.parse(jsonMatch[0]) as { violations?: AuditCorrection[] }
    const violations = Array.isArray(parsed.violations) ? parsed.violations : []
    const elapsed = Date.now() - startedAt
    console.log(
      `[Audit Agent] Opus returned ${violations.length} violation(s) in ${elapsed}ms`,
    )
    if (violations.length === 0) {
      return { markdown, violationsFound: 0, violationsApplied: 0 }
    }

    // Apply corrections via string replacement. Sort by offendingText
    // length descending so we replace the largest chunks first
    // (prevents a shorter substring correction from clobbering a
    // longer overlapping one).
    const sorted = [...violations].sort(
      (a, b) => (b.offendingText?.length ?? 0) - (a.offendingText?.length ?? 0),
    )
    let current = markdown
    let applied = 0
    for (const v of sorted) {
      if (!v.offendingText || v.correctedText === undefined) continue
      if (typeof v.offendingText !== 'string' || typeof v.correctedText !== 'string') continue
      // Sanitize the correction (gibberish check + tag normalization
      // + post-render substitutions) so a bad Opus emission can't
      // introduce new violations.
      let corrected = v.correctedText
      corrected = applyPostRenderSubstitutions(corrected)
      corrected = normalizeConfidenceTagSpacing(sanitizeText(corrected, `audit-agent:${v.dimension}`))
      // Empty correction means "drop this text" or "no clean fix".
      // If correctedText === '' AND severity === warning, it's just a
      // flag — don't apply. If '' AND critical, we drop the offense.
      if (corrected === '' && v.severity !== 'critical') {
        console.warn(
          `[Audit Agent] Skipping dimension-${v.dimension} violation with empty correction (warning-only flag).`,
        )
        continue
      }
      const idx = current.indexOf(v.offendingText)
      if (idx === -1) {
        console.warn(
          `[Audit Agent] offendingText not found in markdown - skipping. Preview: "${v.offendingText.slice(0, 80)}..."`,
        )
        continue
      }
      current =
        current.slice(0, idx) + corrected + current.slice(idx + v.offendingText.length)
      applied++
      console.log(
        `[Audit Agent] Applied dimension-${v.dimension} (${v.severity}) correction. Reason: ${v.explanation.slice(0, 100)}`,
      )
    }
    console.log(
      `[Audit Agent] Applied ${applied}/${violations.length} corrections`,
    )
    return { markdown: current, violationsFound: violations.length, violationsApplied: applied }
  } catch (err) {
    console.warn('[Audit Agent] Failed:', err)
    return { markdown, violationsFound: 0, violationsApplied: 0 }
  }
}
