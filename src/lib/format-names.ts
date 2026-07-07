/**
 * Shared name formatters for organizations and journals.
 *
 * NIH RePORTER and PubMed feed names in a mix of ALL-CAPS and mixed-case
 * depending on source vintage — "UNIVERSITY OF CALIFORNIA LOS ANGELES"
 * from one row, "University of California Los Angeles" from another.
 * These helpers normalize consistently so UI cards, chat responses, and
 * generated reports all render the same way.
 *
 * Extracted from src/lib/reports/synthesize.ts so non-report code paths
 * (detail pages, chat, admin, sample) can share the same normalization.
 * Do not duplicate this logic elsewhere — import from here.
 */

// Acronyms that should stay all-caps in org/journal names.
export const ORG_ACRONYMS = new Set([
  'NIH', 'NSF', 'MIT', 'UCLA', 'USC', 'UCSF', 'UCSD', 'UCSB', 'UCB', 'UNC',
  'UCD', 'UCI', 'UCR', 'CSU', 'CMU', 'UC', 'IBM', 'HHMI', 'ASU', 'SUNY',
  'CUNY', 'NYU', 'LLC', 'PC', 'CRO', 'CDMO', 'USA', 'UK', 'BIDMC', 'MGH',
  'CHOP', 'CSHL', 'NIST', 'EPA', 'FDA', 'CDC', 'DOE', 'DARPA', 'OHSU',
  'MD', 'PhD', 'DDS', 'DVM', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI',
  'XII', 'PLOS', 'EMBO', 'JCI', 'NEJM', 'BMJ', 'JAMA', 'PNAS', 'EBO',
])

export const ORG_SMALL_WORDS = new Set([
  'of', 'the', 'and', 'in', 'for', 'on', 'at', 'to', 'a', 'an', 'or', 'as',
  'by', 'with', 'from', 'de', 'la', 'le', 'du',
])

// Journals with intentional non-standard casing — substitute after title-casing
const JOURNAL_CASE_FIXES: Array<[RegExp, string]> = [
  [/\bBiorxiv\b/g, 'bioRxiv'],
  [/\bMedrxiv\b/g, 'medRxiv'],
  [/\bArxiv\b/g, 'arXiv'],
  [/\bMbio\b/g, 'mBio'],
  [/\bElife\b/g, 'eLife'],
  [/\bPlos\b/g, 'PLOS'],
  [/\bEmbo\b/g, 'EMBO'],
  [/\bJci\b/g, 'JCI'],
  [/\bNejm\b/g, 'NEJM'],
  [/\bBmj\b/g, 'BMJ'],
  [/\bJama\b/g, 'JAMA'],
  [/\bPnas\b/g, 'PNAS'],
  [/\bIscience\b/g, 'iScience'],
]

/**
 * Title-case a single token, preserving internal hyphens and acronyms.
 * Treats '/' and '.' as internal word boundaries so
 * "INSTITUTE/CITY OF HOPE" → "Institute/City of Hope" rather than
 * "Institute/city of Hope" (r18 audit finding).
 */
export function titleCaseToken(token: string): string {
  return token.split('-').map(part => {
    const alpha = part.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha)) return part
    let result = ''
    let firstLetterDone = false
    for (const c of part) {
      if (/[A-Za-z]/.test(c)) {
        if (!firstLetterDone) {
          result += c.toUpperCase()
          firstLetterDone = true
        } else {
          result += c.toLowerCase()
        }
      } else {
        result += c
        if (c === '/' || c === '.') {
          firstLetterDone = false
        }
      }
    }
    return result
  }).join('-')
}

/**
 * Normalize an organization name from NIH RePORTER data:
 * - Strips trailing extra closing parens (data quirk: "X (Y))")
 * - Title-cases all-caps strings (e.g. "STANFORD UNIVERSITY" → "Stanford University")
 * - Preserves known acronyms (MIT, UCLA, NIH)
 * - Lowercases small connector words (of, the, and)
 * - Leaves already-mixed-case names alone
 */
export function normalizeOrgName(name: string | null | undefined): string {
  if (!name) return ''
  let cleaned = name.trim()
  cleaned = cleaned.replace(/\){2,}$/, ')')
  if (/[a-z]/.test(cleaned)) return cleaned

  const tokens = cleaned.split(/(\s+)/)
  let firstNonSpaceFound = false

  return tokens.map(token => {
    if (/^\s+$/.test(token) || !token) return token
    const isFirst = !firstNonSpaceFound
    firstNonSpaceFound = true

    const alpha = token.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha)) return token
    if (!isFirst && ORG_SMALL_WORDS.has(alpha.toLowerCase())) {
      return token.toLowerCase()
    }
    return titleCaseToken(token)
  }).join('')
}

/**
 * Title-case a journal name and apply known special-case fixes (bioRxiv, PLOS, etc.)
 * Always normalizes regardless of input casing, since PubMed feeds
 * inconsistently cased journals.
 */
export function normalizeJournalName(name: string | null | undefined): string {
  if (!name) return ''
  const trimmed = name.trim()
  if (!trimmed) return ''

  const tokens = trimmed.split(/(\s+)/)
  let firstNonSpaceFound = false

  let result = tokens.map(token => {
    if (/^\s+$/.test(token) || !token) return token
    const isFirst = !firstNonSpaceFound
    firstNonSpaceFound = true

    const alpha = token.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha.toUpperCase()) && alpha === alpha.toUpperCase()) return token
    if (!isFirst && ORG_SMALL_WORDS.has(alpha.toLowerCase())) {
      return token.toLowerCase()
    }
    return titleCaseToken(token)
  }).join('')

  for (const [pattern, replacement] of JOURNAL_CASE_FIXES) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * Normalize a PI name. NIH stores PI names in various casings; PubMed
 * uses "Last, First" or "First Last" formats. This function title-cases
 * them consistently while preserving hyphens and known acronyms
 * (e.g. "SMITH, JOHN JR III" → "Smith, John Jr III").
 */
export function normalizePIName(name: string | null | undefined): string {
  if (!name) return ''
  const cleaned = name.trim()
  if (!cleaned) return ''
  if (/[a-z]/.test(cleaned)) return cleaned

  const tokens = cleaned.split(/(\s+|,)/)
  return tokens.map(token => {
    if (/^\s+$/.test(token) || token === ',' || !token) return token
    const alpha = token.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha)) return token
    return titleCaseToken(token)
  }).join('')
}
