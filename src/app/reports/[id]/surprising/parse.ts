// Parser for the "What Surprised Us" markdown section — converts the
// LLM-emitted format into structured findings the render layer can
// treat as data rather than as prose.
//
// The synthesis step (renderSurprisingFindings in synthesize.ts) emits:
//
//   **1. Headline text**
//
//   Interpretation paragraph. May end with an INLINE confidence tag
//   like "**Confidence: Low** - Evidence: ..." when the LLM produced
//   one inside the interpretation. OR the tag can be on its own line
//   below the interpretation.
//
//   **Confidence: Low** - Evidence: text.  ← standalone form
//
// The renderer previously left inline tags mid-paragraph and only
// styled the standalone form as separate text — inconsistent visual
// treatment for the same semantic element. This parser normalizes:
// extracts the confidence + evidence regardless of position, so the
// UI can always render them as a colored chip below the claim.

export type Confidence = 'High' | 'Medium' | 'Low'

export interface SurprisingFinding {
  /** 1-indexed position as it appeared in the report. */
  index: number
  /** Headline from the `**N. headline**` line. */
  headline: string
  /** Interpretation paragraph, stripped of any inline confidence/evidence text. */
  interpretation: string
  /** Extracted confidence tier if the finding included one. */
  confidence: Confidence | null
  /** Extracted evidence text if the finding included one. */
  evidence: string | null
}

/**
 * Extract structured findings from the raw "What Surprised Us"
 * section body. Assumes the body already excludes the `## What
 * Surprised Us` heading and the italic caption below it (the caller
 * splits those out for its own header render).
 */
export function extractSurprisingFindings(body: string): SurprisingFinding[] {
  if (!body?.trim()) return []

  // Split into finding blocks. Each block begins with `**N. headline**`
  // at start of a line. Use a lookahead to keep the delimiter in the
  // result, then filter out any prefix chunk before the first finding
  // (typically the italic caption if the caller passed the section
  // body raw).
  const parts = body.split(/(?=^\*\*\d+\.\s+[^*]+\*\*\s*$)/m)
  const findings: SurprisingFinding[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    // Match the headline line + the rest.
    const m = trimmed.match(/^\*\*(\d+)\.\s+([^*]+?)\*\*\s*\n?([\s\S]*)$/)
    if (!m) continue
    const index = Number(m[1])
    const headline = m[2].trim()
    const rest = (m[3] ?? '').trim()

    // Extract the confidence tag from wherever it appears (inline or
    // standalone). Pattern: `**Confidence: X**` optionally followed by
    // ` - Evidence: ...` up to end of paragraph or end of block.
    let confidence: Confidence | null = null
    let evidence: string | null = null
    let interpretation = rest

    const tagMatch = rest.match(
      /\*\*Confidence:\s*(High|Medium|Low)\*\*(?:\s*[-–—]\s*Evidence:\s*([\s\S]*?))?(?=\n\n|\n\*\*|$)/i,
    )
    if (tagMatch) {
      confidence = tagMatch[1] as Confidence
      if (tagMatch[2]) evidence = tagMatch[2].trim().replace(/\s+/g, ' ')
      interpretation = rest
        .replace(tagMatch[0], '')
        .replace(/^\s*[-–—]\s*$/gm, '') // stray dashes left behind
        .trim()
    }

    // Also handle a separate `*Evidence: ...*` line that some renders
    // emit when confidence is inline but evidence isn't.
    if (!evidence) {
      const italicEvidence = interpretation.match(/\*Evidence:\s*([\s\S]*?)\*(?=\n|$)/i)
      if (italicEvidence) {
        evidence = italicEvidence[1].trim().replace(/\s+/g, ' ')
        interpretation = interpretation.replace(italicEvidence[0], '').trim()
      }
    }

    // Clean up trailing punctuation/whitespace artifacts left by the
    // extraction (e.g. a paragraph that ended "...worth investigating.
    // **Confidence: Low**" now ends "...worth investigating.").
    interpretation = interpretation.replace(/\s+\.$/, '.').trim()

    findings.push({ index, headline, interpretation, confidence, evidence })
  }

  return findings
}

/**
 * Extract the italic caption at the top of the section (the standard
 * "Non-obvious findings detected algorithmically..." disclaimer)
 * so it can be rendered as a subtitle above the finding cards
 * rather than inside them.
 *
 * The caption is emitted as the first paragraph, wrapped in single-
 * asterisk italics. It may CONTAIN inline `**bold**` sequences (e.g.
 * "flagged hypotheses" in the default caption), so we can't just match
 * `*...*` non-greedily — the first `*` of `**bold**` would end the
 * match early. Instead: split on paragraph boundaries, take the first,
 * and if the whole paragraph is wrapped in `*...*`, strip the wrapper.
 */
export function extractSurprisingCaption(body: string): string {
  const firstPara = body.trim().split(/\n\s*\n/)[0]?.trim() ?? ''
  if (!firstPara) return ''
  // Wrapper italic: starts with * (not **) and ends with * (not **),
  // with content in between. The negative lookaheads/lookbehinds keep
  // us from confusing this with a bold marker.
  if (firstPara.startsWith('*') && !firstPara.startsWith('**')
      && firstPara.endsWith('*') && !firstPara.endsWith('**')) {
    return firstPara.slice(1, -1).trim()
  }
  return ''
}
