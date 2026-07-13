/**
 * Post-render substitutions. Deterministic string replacements applied
 * to LLM-generated markdown after assembly. The prompt-level bans keep
 * catching the same phrases, so we belt-and-suspenders strip them at
 * the end.
 *
 * IMPORTANT: this must be run on both the initial assembly AND on any
 * text produced by lint-retry corrections. r40 audit found em dashes
 * pervasive because retry-corrected sections weren't going through
 * this pass - only the initial assembly was.
 */

/**
 * Post-render substitutions that don't need topResearcher context.
 * Called from assembleMarkdown and from lint-retry.
 */
export function applyPostRenderSubstitutions(input: string): string {
  let md = input

  // Em-dash purge (U+2014). Product convention is hyphens only.
  // Replace with " - " and collapse duplicate spaces.
  md = md.replace(/—/g, ' - ')
  md = md.replace(/ {2,}- {2,}/g, ' - ').replace(/ +- +/g, ' - ')

  // AI-tell phrases.
  md = md.replace(/\binflection point\b/gi, 'juncture')
  // Both "genuine [X]" and "genuinely [X]" get the modifier stripped.
  // r41 audit found "genuinely unclear" surviving because the regex
  // required "genuine" + word boundary before the space.
  md = md.replace(/\bgenuinely\s+(\w+)/gi, '$1')
  md = md.replace(/\bgenuine\s+(\w+)/gi, '$1')
  md = md.replace(/\bunderscoring\b/gi, 'highlighting')
  md = md.replace(/\bunderscored\b/gi, 'highlighted')
  md = md.replace(/\bunderscores\b/gi, 'highlights')
  md = md.replace(/\bunderscore\b/gi, 'highlight')

  // "structural [claim-noun]" - drop the modifier.
  md = md.replace(
    /\bstructural(?:ly)?\s+(competitive risks?|shifts?|changes?|risks?|barriers?|advantages?|dynamics?)\b/gi,
    '$1',
  )

  // Field-level absolute adverbs before "sparse"/"absent"/"scarce" -
  // "strikingly sparse", "notably sparse", "remarkably absent" drift
  // toward field-level claims a sample cannot support. Strip the
  // adverb; the noun-phrase alone reads as observation-in-sample.
  // r46 audit flagged this pattern.
  md = md.replace(
    /\b(strikingly|notably|remarkably|conspicuously|glaringly)\s+(sparse|absent|scarce|underrepresented|thin|missing)\b/gi,
    '$2',
  )

  // "structurally invisible" as a scope caveat trips
  // no-sample-share-to-structural because "structural" is the banned
  // token. The LLM keeps picking this phrasing to hedge "activity
  // outside the sample". r48 audit caught it in both Exec Summary
  // and Signals Analysis. Rewrite to "not captured here".
  md = md.replace(/\bstructurally\s+invisible\s+here\b/gi, 'not captured here')
  md = md.replace(/\bstructurally\s+invisible\b/gi, 'not captured in this sample')

  return md
}

/**
 * Strip PI-possessive constructions ("Velculescu's DELFI") using a
 * list of surnames. Kept separate from applyPostRenderSubstitutions
 * because it requires context (topResearchers list).
 */
export function stripPiPossessives(input: string, surnames: Iterable<string>): string {
  const escapedSet = Array.from(surnames)
    .filter((s) => s.length >= 3)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escapedSet.length === 0) return input
  const escaped = escapedSet.join('|')
  let md = input
  const possessive = new RegExp(`\\b(${escaped})['’]s\\s+`, 'gi')
  md = md.replace(possessive, '')
  const groupRef = new RegExp(`\\bthe\\s+(${escaped})\\s+(lab|group|team)\\b`, 'gi')
  md = md.replace(groupRef, 'the $2')
  return md
}
