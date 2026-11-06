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

// Unicode confusables — Cyrillic letters that look like Latin letters.
// These leak into LLM output (and into web content the market-context
// scrape ingests before the LLM ever sees it) and silently corrupt
// brand names, URLs, and search terms. Known case: "NeurоNexus" with
// Cyrillic 'о' (U+043E) in place of Latin 'o' (U+006F) — breaks copy-
// paste, in-page find, and any downstream keyword match.
//
// Greek letters are deliberately NOT normalized here — they have
// legitimate scientific uses in this corpus (α-synuclein, TNF-α,
// IFN-γ, β-amyloid, etc.) where swapping to Latin would corrupt
// real content.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  // Lowercase
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'у': 'y', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  // Uppercase
  'А': 'A', 'В': 'B', 'Е': 'E', 'Н': 'H', 'К': 'K',
  'М': 'M', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T',
  'Х': 'X', 'У': 'Y', 'Ѕ': 'S', 'І': 'I', 'Ј': 'J',
}
const CYRILLIC_CONFUSABLE_RE = new RegExp(
  '[' + Object.keys(CYRILLIC_TO_LATIN).join('') + ']',
  'g',
)

/**
 * Replace Cyrillic look-alike characters with their Latin equivalents.
 * Idempotent. Safe to apply unconditionally in this app's
 * English-language corpus — we have no Russian/Ukrainian content path,
 * so any Cyrillic in generated text is contamination, not intent.
 *
 * Exported so callers that bypass sanitizeText (e.g. the market-
 * context web-scrape path) can still de-confusable before persist.
 */
export function normalizeConfusables(text: string): string {
  return text.replace(CYRILLIC_CONFUSABLE_RE, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
}

export function sanitizeText(raw: unknown, contextLabel = 'text'): string {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  // Normalize confusables FIRST, before the heuristic gibberish checks
  // run. A word like "NeurоNexus" (Cyrillic о) passes every gibberish
  // check — it looks like valid English — while silently breaking
  // downstream keyword search and copy-paste. Catch it here and let
  // the rest of the pipeline treat the text as the user expects.
  const text = normalizeConfusables(raw)

  const tokens = text.match(/[a-zA-Z]{3,}/g) || []
  for (const token of tokens) {
    const lower = token.toLowerCase()

    // Signal 1: all-consonant tokens >=7 chars (raised from 5 after r33
    // smoke-test surfaced NSCLC as a false positive). Legit biomedical
    // acronyms sit in the 3-6 char range (NSCLC, SCLC, HCC, RNA, DNA,
    // cfDNA, ctDNA, MRD, ML, AI, LC-MS, mAb, EGFR, KRAS, HER2, PDL1);
    // gibberish tokens from LLM corruption were 8+ chars in the r29
    // incident ("bifldttiifillhih", "dttibiltfhthbd"). Raising to 7
    // eliminates the acronym false-positive class while still catching
    // corruption.
    if (lower.length >= 7 && !/[aeiouy]/.test(lower)) {
      console.warn(
        `[Sanitize] Rejected ${contextLabel} - all-consonant token "${token}" (${lower.length} chars). Preview:`,
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
