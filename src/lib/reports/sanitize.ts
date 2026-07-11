/**
 * Sanitize LLM-generated narrative text against gibberish emissions.
 *
 * r31 audit surfaced garbled tokens shipping in strategicImplications
 * blocks ("ihihhiiliil lidi", "tillif thk thliid dttibiltfhthbd") that
 * the previous vowel-ratio check missed because the tokens contained
 * vowels and were <7 chars. This module implements a broader set of
 * heuristics and is applied uniformly across every LLM narrative
 * field (Field Maturity, Competitive Topology, IP, White Space,
 * Section Insights, etc).
 *
 * Extracted from synthesize.ts (r31) so white-space.ts and other
 * downstream modules can call it without a circular import.
 */

export function sanitizeText(raw: unknown, contextLabel = 'text'): string {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  const text = raw

  const tokens = text.match(/[a-zA-Z]{3,}/g) || []
  for (const token of tokens) {
    const lower = token.toLowerCase()

    // Signal 1: all-consonant tokens >=5 chars. Real English words
    // >4 chars almost always contain a vowel.
    if (lower.length >= 5 && !/[aeiouy]/.test(lower)) {
      console.warn(
        `[Sanitize] Rejected ${contextLabel} - all-consonant token "${token}". Preview:`,
        text.slice(0, 160),
      )
      return ''
    }

    // Signal 2: low unique-character ratio on tokens >=6 chars. Real
    // words rarely dip below 0.4 unique/length. "ihihhiiliil" has
    // 3 unique / 11 = 0.27, clear gibberish.
    if (lower.length >= 6) {
      const uniqueChars = new Set(lower).size
      const ratio = uniqueChars / lower.length
      if (ratio < 0.4) {
        console.warn(
          `[Sanitize] Rejected ${contextLabel} - low unique-char ratio ${ratio.toFixed(2)} on token "${token}". Preview:`,
          text.slice(0, 160),
        )
        return ''
      }
    }

    // Signal 3: 3+ consecutive identical characters within a >=5 char
    // token. Real English words don't have "aaa" or "bbb" runs.
    if (/(.)\1{2,}/.test(lower) && lower.length >= 5) {
      console.warn(
        `[Sanitize] Rejected ${contextLabel} - triple-repeated char in "${token}". Preview:`,
        text.slice(0, 160),
      )
      return ''
    }
  }

  // Signal 4: overall vowel ratio for longer texts (>40 alphabetic
  // chars). Normal English prose sits above ~35%. Below 25% is
  // structurally implausible.
  const alphaChars = text.match(/[a-z]/gi) || []
  const vowels = text.match(/[aeiou]/gi) || []
  if (alphaChars.length > 40) {
    const ratio = vowels.length / alphaChars.length
    if (ratio < 0.25) {
      console.warn(
        `[Sanitize] Rejected ${contextLabel} - vowel ratio ${ratio.toFixed(2)} below 0.25. Preview:`,
        text.slice(0, 160),
      )
      return ''
    }
  }
  return text
}
