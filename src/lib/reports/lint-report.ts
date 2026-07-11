/**
 * Report Linter — deterministic post-generation QA gate.
 *
 * Codifies the audit rubric we've been enforcing across ~29 rounds of
 * human/LLM review into a set of programmatic checks. Runs against the
 * assembled markdown string plus the underlying data payload. Zero LLM
 * calls, zero external API cost. Fires on every generated report and
 * catches regressions the moment a prompt change reintroduces a
 * previously-fixed issue.
 *
 * Not a replacement for reviewer judgment on NEW classes of issues —
 * this enforces the ones we've already decided on. Think of it as CI
 * for report quality.
 *
 * Design principles:
 *   - Deterministic: same input, same output. No LLM in the loop.
 *   - Severity-tagged: 'critical' violations block a ship-worthy report;
 *     'warning' violations are logged but don't fail.
 *   - Explainable: every violation includes the section, the offending
 *     substring, and a one-line reason so an engineer or reviewer can
 *     debug without re-reading the whole rubric.
 *   - Cheap to extend: adding a new rule is one entry in RULES.
 */

import type { AllAgentOutputs, FundingStats, WhiteSpaceAnalysis, ResearcherStats } from './types'

export type LintSeverity = 'critical' | 'warning'

export interface LintViolation {
  ruleId: string
  severity: LintSeverity
  section: string | null
  offending: string | null
  message: string
}

export interface LintContext {
  markdown: string
  agentOutputs: AllAgentOutputs
  fundingStats: FundingStats
  topResearchers: ResearcherStats[]
  whiteSpace: WhiteSpaceAnalysis
}

// -----------------------------------------------------------------------
// Section extraction — most rules only care about specific sections.
// -----------------------------------------------------------------------

/**
 * Split the markdown into named sections keyed by their `## ` heading.
 * Includes the heading line in the value. Returns a Map so lookups don't
 * silently miss on typos.
 */
function extractSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = markdown.split('\n')
  let currentHeading: string | null = null
  let currentLines: string[] = []
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentLines.join('\n'))
      }
      currentHeading = match[1].trim()
      currentLines = [line]
    } else if (currentHeading !== null) {
      currentLines.push(line)
    }
  }
  if (currentHeading !== null) {
    sections.set(currentHeading, currentLines.join('\n'))
  }
  return sections
}

// The narrative sections where PI names should never appear. Structured
// project/patent/publication detail sections are EXCLUDED from this list
// because PI names are legitimate metadata there (per the transactional-
// vs-narrative rule saved to memory 2026-07-10).
const NARRATIVE_SECTION_NAMES = [
  'Executive Summary',
  'What Surprised Us',
  'Field Maturity Assessment',
  'Competitive Topology',
  'White Space Analysis',
  'Research Positioning',
  'NIH Funding Landscape',
  'Market Context',
  'Clinical Validation Status',
  'Patent Activity',
  'Next Steps',
]

// -----------------------------------------------------------------------
// Rule implementations
// -----------------------------------------------------------------------

interface Rule {
  id: string
  severity: LintSeverity
  check: (ctx: LintContext, sections: Map<string, string>) => LintViolation[]
}

const RULES: Rule[] = [
  // ------------------------------------------------------------------
  // Callout etiquette: PI names must not appear in narrative sections.
  // ------------------------------------------------------------------
  {
    id: 'no-pi-names-in-narrative',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      // Build the set of PI display names to check for. Guard against
      // very short or generic single-word names that would match too
      // broadly (e.g., a PI named "Wang" would match "Wang et al" in
      // publication titles).
      const piNames = ctx.topResearchers
        .map((r) => (r.pi_name || '').trim())
        .filter((n) => n.length > 0 && n.split(/[\s,]+/).length >= 2)
      for (const sectionName of NARRATIVE_SECTION_NAMES) {
        const body = sections.get(sectionName)
        if (!body) continue
        for (const name of piNames) {
          // Case-insensitive whole-name substring match. PIs are stored
          // in "Last, First" form in NIH data; also check "First Last"
          // reversal.
          const variants = new Set<string>([name])
          const commaSplit = name.split(',').map((s) => s.trim())
          if (commaSplit.length === 2) {
            variants.add(`${commaSplit[1]} ${commaSplit[0]}`)
          }
          for (const v of variants) {
            const regex = new RegExp(`\\b${escapeRegex(v)}\\b`, 'i')
            const match = body.match(regex)
            if (match) {
              violations.push({
                ruleId: 'no-pi-names-in-narrative',
                severity: 'critical',
                section: sectionName,
                offending: match[0],
                message: `PI name "${match[0]}" appeared in narrative section "${sectionName}". PI names belong in Key Researchers / project detail cards only.`,
              })
              break
            }
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Banned AI-tell phrases — kill on sight anywhere in the markdown.
  // ------------------------------------------------------------------
  {
    id: 'no-banned-ai-tell-phrases',
    severity: 'critical',
    check(ctx) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\binflection point\b/i, label: 'inflection point' },
        { regex: /\bstep-change\b/i, label: 'step-change' },
        { regex: /\bposed to\b/i, label: 'poised to (misspelled variant)' },
        { regex: /\bpoised to\b/i, label: 'poised to' },
        { regex: /\bunderscores\b/i, label: 'underscores' },
        { regex: /\blandscape reveals\b/i, label: 'landscape reveals' },
        { regex: /\bperhaps most critically\b/i, label: 'perhaps most critically' },
        // "genuine [noun]" pattern where genuine modifies an abstract
        // claim word. Whitelist "genuine attempt to" or similar concrete
        // uses by only flagging the abstract-claim forms.
        {
          regex:
            /\bgenuine (opportunity|opportunities|methodological|scientific|biological|differentiation|gap|advance|innovation|breakthrough)\b/i,
          label: 'genuine [abstract-claim-noun]',
        },
      ]
      const violations: LintViolation[] = []
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-banned-ai-tell-phrases',
            severity: 'critical',
            section: null,
            offending: match[0],
            message: `Banned AI-tell phrase "${label}" appeared in the report.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Field-level absolutes: the sample can't support these claims.
  // ------------------------------------------------------------------
  {
    id: 'no-field-level-absolutes',
    severity: 'critical',
    check(ctx) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\ba clear gap exists\b/i, label: 'a clear gap exists' },
        { regex: /\bstructural underfunding\b/i, label: 'structural underfunding' },
        { regex: /\bstructurally underfunded\b/i, label: 'structurally underfunded' },
        {
          regex: /\bwill pressure\b/i,
          label: 'will pressure (use "is likely to pressure")',
        },
        {
          regex: /\bwill force\b/i,
          label: 'will force (use "is likely to force")',
        },
        {
          regex: /\bfield has abandoned\b/i,
          label: 'field has abandoned',
        },
      ]
      const violations: LintViolation[] = []
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-field-level-absolutes',
            severity: 'critical',
            section: null,
            offending: match[0],
            message: `Field-level absolute "${label}" — the sample cannot support this claim.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Em dashes — banned by product convention.
  // ------------------------------------------------------------------
  {
    id: 'no-em-dashes',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      // Count occurrences and cap the reported message to keep output
      // scannable. Skip the scope-note area (paragraph starting with
      // "This analysis maps") which historically contains em dashes in
      // a fixed string — the ban applies to LLM-generated prose.
      // [\s\S] to match across newlines without using the /s flag
      // (requires es2018 in the tsconfig, and we build against an
      // older baseline).
      const scopeNoteRegex = /This analysis maps[\s\S]*?(?=\n\n)/
      const withoutScope = ctx.markdown.replace(scopeNoteRegex, '')
      const emDashCount = (withoutScope.match(/—/g) || []).length
      if (emDashCount > 0) {
        violations.push({
          ruleId: 'no-em-dashes',
          severity: 'warning',
          section: null,
          offending: '—',
          message: `${emDashCount} em dash(es) found. Product convention is hyphens only.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Inline Confidence tags — must be preceded by a blank line.
  // ------------------------------------------------------------------
  {
    id: 'no-inline-confidence-tags',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Match Confidence tags NOT preceded by a blank line (i.e. any
      // non-blank line ending followed by the tag on the same or next
      // line without an intervening blank line). We look for the tag
      // pattern preceded by content + single \n.
      const pattern = /[^\n]\n\*\*Confidence:\s*(High|Medium|Low)\*\*/g
      let match: RegExpExecArray | null
      let count = 0
      while ((match = pattern.exec(ctx.markdown)) !== null) {
        count++
        if (count > 5) break // cap reporting
      }
      if (count > 0) {
        violations.push({
          ruleId: 'no-inline-confidence-tags',
          severity: 'critical',
          section: null,
          offending: '**Confidence: ...**',
          message: `${count === 6 ? '6+' : count} Confidence tag(s) run inline (no preceding blank line). normalizeConfidenceTagSpacing should have reflowed them.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Strategic Implications blocks must end with a Confidence tag.
  // ------------------------------------------------------------------
  {
    id: 'strategic-implications-must-end-with-confidence-tag',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      // Grab every "### Strategic Implications" block up to the next
      // heading (## or ###).
      const blockPattern = /### Strategic Implications\n\n([\s\S]*?)(?=\n(?:##|###)\s|$)/g
      let match: RegExpExecArray | null
      let idx = 0
      while ((match = blockPattern.exec(ctx.markdown)) !== null) {
        idx++
        const body = match[1].trim()
        // Verify the block contains at least one Confidence tag near
        // the end. "Near the end" = within the last 400 chars.
        const tail = body.slice(-400)
        if (!/\*\*Confidence:\s*(High|Medium|Low)\*\*/.test(tail)) {
          violations.push({
            ruleId: 'strategic-implications-must-end-with-confidence-tag',
            severity: 'warning',
            section: `Strategic Implications block #${idx}`,
            offending: null,
            message: `Strategic Implications block #${idx} does not end with a Confidence + Evidence tag.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // IP concentration label consistency: if patent count < 10, the
  // Patent section must say "Insufficient sample" and no other section
  // should assert a concentration read.
  // ------------------------------------------------------------------
  {
    id: 'ip-concentration-consistency',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      const IP_LABEL_MIN_N = 10
      if (patentCount >= IP_LABEL_MIN_N) return violations
      // Below the threshold: the Patent section must acknowledge
      // insufficient sample. If Next Steps or any other section calls
      // it "concentrated" / "fragmented", that's a contradiction.
      const patentBody = sections.get('Patent Activity') || ''
      if (!/insufficient sample/i.test(patentBody)) {
        violations.push({
          ruleId: 'ip-concentration-consistency',
          severity: 'critical',
          section: 'Patent Activity',
          offending: null,
          message: `Patent Activity section does not carry "insufficient sample" language despite only ${patentCount} linked patents (threshold is ${IP_LABEL_MIN_N}).`,
        })
      }
      // Check Next Steps + Strategic Implications for stray
      // concentration claims.
      const suspects = ['Next Steps', 'Patent Activity']
      const concentrationPattern =
        /\b(?:moderately concentrated|highly concentrated|fragmented)\b/i
      for (const sectionName of suspects) {
        const body = sections.get(sectionName) || ''
        // Allow the phrase inside the "Insufficient sample" explainer
        // string ("a landscape label like 'concentrated' or 'fragmented'
        // requires ..."). Strip that explainer before checking.
        const bodyWithoutExplainer = body.replace(
          /a landscape label like[\s\S]*?to be meaningful/gi,
          '',
        )
        const match = bodyWithoutExplainer.match(concentrationPattern)
        if (match) {
          violations.push({
            ruleId: 'ip-concentration-consistency',
            severity: 'critical',
            section: sectionName,
            offending: match[0],
            message: `"${match[0]}" appears in ${sectionName} despite only ${patentCount} linked patents. Contradicts the Patent section's insufficient-sample stance.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Category shares in Exec Summary must name the taxonomy source.
  // ------------------------------------------------------------------
  {
    id: 'exec-summary-names-taxonomy',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const exec = sections.get('Executive Summary') || ''
      if (!exec) return violations
      // If the Executive Summary references a category name from
      // fundingStats.byCategory, it should say "funding category" or
      // name the specific taxonomy. Only fire if BOTH conditions hold:
      // (a) the summary cites a category name; (b) the summary does
      // NOT mention "funding category" anywhere.
      const categoryNames = ctx.fundingStats.byCategory
        .slice(0, 6)
        .map((c) => c.category.toLowerCase())
      const mentionsCategory = categoryNames.some((cat) =>
        exec.toLowerCase().includes(cat),
      )
      const mentionsTaxonomySource = /funding category|byCategory/i.test(exec)
      if (mentionsCategory && !mentionsTaxonomySource) {
        violations.push({
          ruleId: 'exec-summary-names-taxonomy',
          severity: 'warning',
          section: 'Executive Summary',
          offending: null,
          message:
            'Executive Summary cites category counts but does not name "funding category" as the taxonomy source. Reader may confuse with the White Space translational-stage taxonomy which uses different counts.',
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Coverage Gap Signals: if any op has sampleCount <= 1, its rendered
  // block must contain the small-sample caveat line.
  // ------------------------------------------------------------------
  {
    id: 'coverage-gap-small-sample-caveat',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const smallSampleOps = ctx.whiteSpace.topOpportunities.filter(
        (op) => op.sampleCount <= 1,
      )
      if (smallSampleOps.length === 0) return violations
      const wsBody = sections.get('White Space Analysis') || ''
      const caveatCount = (
        wsBody.match(/small-sample caveat:/gi) || []
      ).length
      if (caveatCount < smallSampleOps.length) {
        violations.push({
          ruleId: 'coverage-gap-small-sample-caveat',
          severity: 'warning',
          section: 'White Space Analysis',
          offending: null,
          message: `${smallSampleOps.length} Coverage Gap Signal(s) with sampleCount<=1, but only ${caveatCount} "Small-sample caveat" line(s) rendered. Renderer should emit one per small-sample opportunity.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Scope-universe base rate must be surfaced when scopeUniverseCount
  // is available.
  // ------------------------------------------------------------------
  {
    id: 'white-space-scope-universe-visible',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const count = ctx.whiteSpace.scopeUniverseCount
      if (typeof count !== 'number' || count <= 0) return violations
      const countStr = count.toLocaleString()
      if (!ctx.markdown.includes(countStr)) {
        violations.push({
          ruleId: 'white-space-scope-universe-visible',
          severity: 'warning',
          section: 'White Space Analysis',
          offending: null,
          message: `Scope-universe count (${countStr}) not rendered in the White Space section base-rate callout.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Two-point trend hedge: "clear upward trajectory" / "clear
  // accelerating funding" / "sustained growth" on FY-to-FY sit-ups.
  // ------------------------------------------------------------------
  {
    id: 'no-two-point-trend-absolutes',
    severity: 'critical',
    check(ctx) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bclear upward trajectory\b/i, label: 'clear upward trajectory' },
        {
          regex: /\bsustained (funding )?growth\b/i,
          label: 'sustained (funding) growth',
        },
        {
          regex: /\baccelerating (funding|momentum)\b/i,
          label: 'accelerating funding/momentum',
        },
      ]
      const violations: LintViolation[] = []
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-two-point-trend-absolutes',
            severity: 'critical',
            section: null,
            offending: match[0],
            message: `Two-point trend absolute "${label}". A two-year rise is not by itself a trend.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Interventional / phase-labeled framing: never assert 1:1 identity.
  // r29 audit caught "phase-labeled trials above are the interventional
  // subset" in the trial-split explainer — banned construction that
  // implies all interventional trials carry a phase label.
  // ------------------------------------------------------------------
  {
    id: 'no-phase-labeled-interventional-subset',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const match = ctx.markdown.match(
        /phase-labeled trials (?:above )?are the interventional subset/i,
      )
      if (match) {
        violations.push({
          ruleId: 'no-phase-labeled-interventional-subset',
          severity: 'critical',
          section: null,
          offending: match[0],
          message:
            'Banned framing "phase-labeled trials are the interventional subset" — implies all interventional trials carry a phase. Use "the phased subset of X interventional trials."',
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Two-point trend hedge co-occurrence check. Flags any sentence
  // containing two FY dollar figures + a trend verb without the hedge
  // ("two data points do not establish a trend").
  // ------------------------------------------------------------------
  {
    id: 'two-point-trend-hedge-required',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Split into sentences (crude split on period + space/newline).
      const sentences = ctx.markdown.split(/(?<=[.!?])\s+/)
      const twoFYPattern = /FY\d{2,4}[\s\S]{0,80}?FY\d{2,4}/i
      const trendVerbPattern =
        /\b(rose|grew|climbed|jumped|up from|growing|accelerat|sustained|trajectory|suggests growing|signals? (?:growing|increased|sustained|accelerating))\b/i
      const hedgePattern =
        /\b(two data points|two-point trend|two consecutive years)\b/i
      for (const s of sentences) {
        if (twoFYPattern.test(s) && trendVerbPattern.test(s) && !hedgePattern.test(s)) {
          violations.push({
            ruleId: 'two-point-trend-hedge-required',
            severity: 'critical',
            section: null,
            offending: s.slice(0, 160),
            message:
              'Two FY dollar figures cited with a trend verb but no "two data points do not establish a trend" hedge.',
          })
          if (violations.length >= 3) break
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // IP shape words: when linked patents < 10, no distribution-shape
  // claim allowed in Patent/Positioning/Next Steps.
  // ------------------------------------------------------------------
  {
    id: 'no-ip-shape-words-insufficient-sample',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      if (patentCount >= 10) return violations
      const shapePattern =
        /\b(consolidated|distributed across|held across [\w\s]+ rather than|spread across)\b/i
      const suspects = ['Patent Activity', 'Research Positioning', 'Next Steps']
      for (const sectionName of suspects) {
        const body = sections.get(sectionName) || ''
        const cleaned = body.replace(/a landscape label like[\s\S]*?to be meaningful/gi, '')
        const match = cleaned.match(shapePattern)
        if (match) {
          violations.push({
            ruleId: 'no-ip-shape-words-insufficient-sample',
            severity: 'critical',
            section: sectionName,
            offending: match[0],
            message: `IP shape word "${match[0]}" in ${sectionName} despite only ${patentCount} linked patents. Contradicts insufficient-sample stance.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Trial status arithmetic: any "N active or completed" claim must
  // match the pre-computed active/completed count from agentOutputs.
  // ------------------------------------------------------------------
  {
    id: 'trial-status-arithmetic-reconciles',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const ACTIVE = new Set([
        'active, not recruiting',
        'recruiting',
        'enrolling by invitation',
        'completed',
        'not yet recruiting',
        'available',
      ])
      const activeCompleted = ctx.agentOutputs.trials.items.filter((t) =>
        ACTIVE.has((t.study_status || '').toLowerCase().trim()),
      ).length
      const total = ctx.agentOutputs.trials.items.length
      // Look for "N active or completed" or "N trials are active or
      // completed" and reconcile.
      const claimPattern =
        /(\d{1,4})\s+(?:linked )?(?:clinical )?trials?\s+(?:are\s+)?active or completed/gi
      let m: RegExpExecArray | null
      while ((m = claimPattern.exec(ctx.markdown)) !== null) {
        const claimed = parseInt(m[1], 10)
        // Allow a match of either the true active+completed count OR the
        // total (in the edge case where all trials are active/completed).
        if (claimed !== activeCompleted && claimed !== 0) {
          violations.push({
            ruleId: 'trial-status-arithmetic-reconciles',
            severity: 'critical',
            section: null,
            offending: m[0],
            message: `"${m[0]}" doesn't reconcile with the ${activeCompleted} active/completed trials in the data (${total} total). The remainder are terminated/suspended/withdrawn or other status.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Date prefix vs body month token. YYYY-MM prefix on a Market
  // Context recent-development bullet must match the MonthName+YYYY
  // in the body.
  // ------------------------------------------------------------------
  {
    id: 'date-prefix-matches-body',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const MONTHS: Record<string, string> = {
        january: '01',
        february: '02',
        march: '03',
        april: '04',
        may: '05',
        june: '06',
        july: '07',
        august: '08',
        september: '09',
        october: '10',
        november: '11',
        december: '12',
      }
      const bulletPattern = /^\s*(?:-|\*)\s*(\d{4})-(\d{2})\s*:\s*(.+)$/gm
      let m: RegExpExecArray | null
      while ((m = bulletPattern.exec(ctx.markdown)) !== null) {
        const [, prefixYear, prefixMonth, rest] = m
        const bodyMatch = rest.match(
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:\d{1,2}(?:,)?\s+)?(\d{4})\b/i,
        )
        if (!bodyMatch) continue
        const bodyMonth = MONTHS[bodyMatch[1].toLowerCase()]
        const bodyYear = bodyMatch[2]
        if (bodyMonth !== prefixMonth || bodyYear !== prefixYear) {
          violations.push({
            ruleId: 'date-prefix-matches-body',
            severity: 'warning',
            section: 'Market Context',
            offending: m[0].slice(0, 120),
            message: `Date prefix ${prefixYear}-${prefixMonth} contradicts body reference "${bodyMatch[0]}" (${bodyYear}-${bodyMonth}).`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Keyword-artifact mid-tier caution: 3x-10x median. Between the
  // dagger threshold (10x) and the "normal" range. Warning-level.
  // ------------------------------------------------------------------
  {
    id: 'keyword-artifact-mid-tier-caution',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      for (const dim of ctx.whiteSpace.dimensions) {
        const validBroader = dim.categories
          .map((c) => c.broaderNihCount)
          .filter((n) => n > 0 && n !== -1)
          .sort((a, b) => a - b)
        if (validBroader.length < 3) continue
        const median = validBroader[Math.floor(validBroader.length / 2)]
        if (median <= 0) continue
        for (const cat of dim.categories) {
          if (cat.broaderNihCount <= 0 || cat.broaderNihCount === -1) continue
          const ratio = cat.broaderNihCount / median
          if (ratio >= 3 && ratio < 10) {
            violations.push({
              ruleId: 'keyword-artifact-mid-tier-caution',
              severity: 'warning',
              section: `White Space: ${dim.name}`,
              offending: `${cat.name} (${cat.broaderNihCount}, ${ratio.toFixed(1)}x median)`,
              message: `Category "${cat.name}" broader-NIH count ${cat.broaderNihCount} is ${ratio.toFixed(1)}x the dimension median (${median}). Below the ${10}x dagger threshold but still elevated — consider a mid-tier caution note in the narrative.`,
            })
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Gibberish guard on assembled markdown. If any 4+ consecutive
  // consonant cluster survives in the body, the sanitizeInsight guard
  // in synthesize.ts didn't catch it or the string came from another
  // path.
  // ------------------------------------------------------------------
  {
    id: 'no-gibberish',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Acronyms in biomedical/NIH reports commonly have no vowels
      // (STTR, CTC/CTCs, MSKCC, NCCN, MYCN, PDAC, HER2). To avoid false
      // positives, only flag tokens that are BOTH long enough to be
      // implausible acronyms AND have no vowels. r29 garbled tokens
      // ranged from 3-16 chars; the shorter ones are almost always
      // legit acronyms. Set the threshold at 7+ chars so we catch
      // "bifldttiifillhih" (16) without tripping on "mskcc" (5).
      const pattern = /\b([a-z]{7,})\b/gi
      let m: RegExpExecArray | null
      let count = 0
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        const token = m[1].toLowerCase()
        // Skip if any vowel present.
        if (/[aeiouy]/i.test(token)) continue
        // Skip if it looks like a hyphenated compound or has case
        // mixing in the original (already excluded by [a-z]{7,} but
        // being explicit).
        violations.push({
          ruleId: 'no-gibberish',
          severity: 'critical',
          section: null,
          offending: token,
          message: `Suspected gibberish token "${token}" (${token.length} chars, no vowels). LLM output may have corrupted mid-generation.`,
        })
        count++
        if (count >= 3) break
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Prescriptive institution callouts: telling readers to
  // engage/reach/target a named org.
  // ------------------------------------------------------------------
  {
    id: 'no-prescriptive-org-targeting',
    severity: 'warning',
    check(ctx, sections) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\breach out to [A-Z][a-zA-Z\s]+/, label: 'reach out to X' },
        { regex: /\bengage (with|the) [A-Z][a-zA-Z\s]+/, label: 'engage with X' },
        {
          regex: /\bscout collaborators (at|from) [A-Z][a-zA-Z\s]+/,
          label: 'scout collaborators at X',
        },
        {
          regex: /\buse [A-Z][a-zA-Z\s]+ as (a )?(collaboration )?target/i,
          label: 'use X as a (collaboration) target',
        },
      ]
      const violations: LintViolation[] = []
      for (const sectionName of NARRATIVE_SECTION_NAMES) {
        const body = sections.get(sectionName)
        if (!body) continue
        for (const { regex, label } of patterns) {
          const match = body.match(regex)
          if (match) {
            violations.push({
              ruleId: 'no-prescriptive-org-targeting',
              severity: 'warning',
              section: sectionName,
              offending: match[0],
              message: `Prescriptive targeting "${label}" in ${sectionName}. Rewrite as pattern-level observation.`,
            })
          }
        }
      }
      return violations
    },
  },
]

// -----------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------

/**
 * Run all rules against the report and return a flat list of violations.
 * Callers decide how to act: log-and-ship, block-and-retry, or hard-fail.
 */
export function lintReport(ctx: LintContext): LintViolation[] {
  const sections = extractSections(ctx.markdown)
  const violations: LintViolation[] = []
  for (const rule of RULES) {
    try {
      violations.push(...rule.check(ctx, sections))
    } catch (err) {
      // A broken rule shouldn't take down the whole report — log and
      // continue. Reviewers see the count of failed rules in aggregate.
      console.warn(`[Report Linter] Rule ${rule.id} threw:`, err)
    }
  }
  return violations
}

/**
 * Convenience: split violations by severity for callers that treat
 * critical and warning differently.
 */
export function partitionViolations(violations: LintViolation[]): {
  critical: LintViolation[]
  warnings: LintViolation[]
} {
  return {
    critical: violations.filter((v) => v.severity === 'critical'),
    warnings: violations.filter((v) => v.severity === 'warning'),
  }
}

/**
 * Format violations for logging. Compact, one-per-line.
 */
export function formatViolations(violations: LintViolation[]): string {
  if (violations.length === 0) return '[Report Linter] All rules passed.'
  const lines = [
    `[Report Linter] ${violations.length} violation(s):`,
    ...violations.map(
      (v) =>
        `  [${v.severity.toUpperCase()}] ${v.ruleId}${v.section ? ` (${v.section})` : ''}: ${v.message}${v.offending ? ` — offending: "${v.offending}"` : ''}`,
    ),
  ]
  return lines.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
