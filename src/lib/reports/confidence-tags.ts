/**
 * Normalize spacing around inline **Confidence:** tags in LLM-produced
 * narrative and reflow each claim + confidence-block into its own
 * paragraph so long narrative sections are scannable.
 *
 * Prior state: the LLM appends "**Confidence: X** — Evidence: Y." inline
 * after each substantive claim, producing multi-claim paragraphs like:
 *
 *   Claim1. **Confidence: High** — Evidence: E1. Claim2. **Confidence: Medium** — Evidence: E2. Claim3...
 *
 * With three or more claims that becomes an unbroken wall of text.
 * r25 audit called this out. The fix inserts paragraph breaks so each
 * claim/evidence pair renders as its own visual block.
 *
 * Extracted to its own module (r29) so white-space.ts and any other
 * downstream narrative producer can call it — the prior in-file
 * definition in synthesize.ts wasn't reachable from imports of
 * synthesize.ts because it's not exported and creates a circular dep.
 */
export function normalizeConfidenceTagSpacing(text: string): string {
  if (!text) return text
  let out = text
  // Wrap bare "Confidence: High/Medium/Low" (missing ** markers) — check
  // that it's not already wrapped.
  out = out.replace(/(?<!\*\*)\bConfidence:\s*(High|Medium|Low)(?!\*\*)/g, '**Confidence: $1**')
  // Insert punctuation + separator before the tag if glued to a word char.
  // "viable**Confidence: High**" -> "viable. **Confidence: High**"
  out = out.replace(/(\w)(\*\*Confidence:\s*(High|Medium|Low)\*\*)/g, '$1. $2')
  // Also handle punctuation-adjacent (period+immediate tag with no space).
  out = out.replace(/([.!?])(\*\*Confidence:)/g, '$1 $2')

  // Reflow into paragraphs. Insert a blank line BEFORE each Confidence
  // tag so the claim ends and the tag begins in a new paragraph.
  out = out.replace(/\s+(\*\*Confidence:\s*(?:High|Medium|Low)\*\*)/g, '\n\n$1')

  // Insert a blank line AFTER the Evidence content of each block, before
  // the next claim starts. Match from the Confidence marker through the
  // Evidence line up to a period followed by space + capital letter,
  // which signals a new sentence starting a fresh claim. Uses [A-Z]
  // alone (not [A-Z][a-z]) so single-letter words like "A" or "I" that
  // often start a new claim ("A second distinct cluster...") aren't
  // missed.
  out = out.replace(
    /(\*\*Confidence:\s*(?:High|Medium|Low)\*\*[^\n]*?Evidence:[^\n]*?\.)\s+([A-Z])/g,
    '$1\n\n$2',
  )

  // Collapse any resulting triple-newlines and trim leading blanks.
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '')
  return out
}
