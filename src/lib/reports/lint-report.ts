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
        { regex: /\bclear\s+\w+\s+gap\b/i, label: 'clear [word] gap (e.g. "clear methodological gap", "clear point-of-care gap")' },
        { regex: /\bclear\s+gap\s+in\b/i, label: 'clear gap in X' },
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
      // Widened per r32: catches "concentration pattern" as substring
      // in addition to exact phrase matches. Any concentrat/fragment
      // token in patent-adjacent sections when N<10 contradicts the
      // insufficient-sample header.
      const concentrationPattern = /(concentrat|fragment|consolidat)/i
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
      // Widened per r32 audit: catches "concentration pattern",
      // "fragmented landscape", "consolidated view", etc. as substrings
      // rather than requiring exact phrase match. When patents<10, no
      // shape/distribution word is permissible in these sections.
      const shapePattern =
        /(consolidat|fragment|concentrat|distributed across|held across [\w\s]+ rather than|spread across)/i
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
  // What Surprised Us: every finding must contain a Confidence tag.
  // r30 audit found findings with Evidence: line but no Confidence tag.
  // ------------------------------------------------------------------
  {
    id: 'surprising-findings-need-confidence-tag',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const body = sections.get('What Surprised Us') || ''
      if (!body) return violations
      // Split into finding blocks — each starts with "**N. headline**".
      const blocks = body.split(/\n(?=\*\*\d+\.\s)/).slice(1)
      blocks.forEach((block, i) => {
        if (!/\*\*Confidence:\s*(High|Medium|Low)\*\*/.test(block)) {
          violations.push({
            ruleId: 'surprising-findings-need-confidence-tag',
            severity: 'critical',
            section: 'What Surprised Us',
            offending: `Finding #${i + 1}`,
            message: `What Surprised Us finding #${i + 1} carries an Evidence line but no Confidence tag.`,
          })
        }
      })
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Gap-signal floor enforcement: no numbered Coverage Gap Signal
  // should be built on broader-NIH < 30. r30 audit surfaced two.
  // ------------------------------------------------------------------
  {
    id: 'gap-signal-floor-enforced',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const belowFloor = ctx.whiteSpace.topOpportunities.filter(
        (op) => op.broaderNihCount >= 0 && op.broaderNihCount < 30,
      )
      belowFloor.forEach((op) => {
        violations.push({
          ruleId: 'gap-signal-floor-enforced',
          severity: 'critical',
          section: 'White Space Analysis',
          offending: `${op.categoryName} (broader-NIH=${op.broaderNihCount})`,
          message: `Coverage Gap Signal "${op.categoryName}" sits at broader-NIH ${op.broaderNihCount}, below the 30-project floor. rankOpportunities should have excluded it.`,
        })
      })
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Dagger presence per-dimension: any category >=5x dim median (or
  // matching generic terms) should be daggered in the rendered
  // markdown. This catches a case where the render code's dagger
  // logic diverges from the linter's.
  // ------------------------------------------------------------------
  {
    id: 'dagger-applied-when-required',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const OUTLIER = 5
      // Whole-word patterns (r32 audit fix). Previous substring
      // /methylation/i matched "Hydroxymethylation" - false positive.
      const GENERIC =
        /\b(machine learning|artificial intelligence|deep learning|neural networks?|methylation|exosomes?|computational|bioinformatics?|statistical|ml|ai)\b/i
      for (const dim of ctx.whiteSpace.dimensions) {
        const vals = dim.categories
          .map((c) => c.broaderNihCount)
          .filter((n) => n > 0 && n !== -1)
          .sort((a, b) => a - b)
        if (vals.length === 0) continue
        const mid = Math.floor(vals.length / 2)
        const median =
          vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid]
        for (const cat of dim.categories) {
          if (cat.broaderNihCount <= 0 || cat.broaderNihCount === -1) continue
          const ratioTrigger = median > 0 && cat.broaderNihCount / median >= OUTLIER
          const genericTrigger = GENERIC.test(cat.name)
          if (!ratioTrigger && !genericTrigger) continue
          // The rendered row for this category should contain "[†]".
          // We check the markdown for a line containing the category
          // name AND [†]. Rough but catches the common cases.
          const escaped = cat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const rowPattern = new RegExp(`\\|\\s*${escaped}\\s*\\|[^\\n]*\\[†\\]`, 'i')
          if (!rowPattern.test(ctx.markdown)) {
            violations.push({
              ruleId: 'dagger-applied-when-required',
              severity: 'warning',
              section: `White Space: ${dim.name}`,
              offending: `${cat.name} (broader-NIH=${cat.broaderNihCount}, ${ratioTrigger ? `${(cat.broaderNihCount / median).toFixed(1)}x median` : 'generic term'})`,
              message: `Category "${cat.name}" qualifies for a [†] dagger but isn't marked in the rendered table.`,
            })
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Forward-looking "will [verb]" absolutes.
  // ------------------------------------------------------------------
  {
    id: 'no-forward-will-absolutes',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const pattern =
        /\bwill (pressure|force|drive|increase|accelerate|require|shift)\b/gi
      let m: RegExpExecArray | null
      let count = 0
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        count++
        if (count > 3) break
        violations.push({
          ruleId: 'no-forward-will-absolutes',
          severity: 'warning',
          section: null,
          offending: m[0],
          message: `Forward-looking absolute "${m[0]}". Use "is likely to ${m[1]}", "may ${m[1]}", or drop the future tense.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // IP breadth/multiplicity claims when patents < 10.
  // ------------------------------------------------------------------
  {
    id: 'no-ip-breadth-claims-insufficient-sample',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      if (patentCount >= 10) return violations
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bbreadth of (methods|approaches)\b/i, label: 'breadth of methods/approaches' },
        {
          regex: /\bmultiple independent (patent families|technical approaches)\b/i,
          label: 'multiple independent patent families/approaches',
        },
        {
          regex: /\bpursued across multiple\b/i,
          label: 'pursued across multiple',
        },
        {
          regex: /\brather than converging\b/i,
          label: 'rather than converging',
        },
      ]
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-ip-breadth-claims-insufficient-sample',
            severity: 'critical',
            section: 'Patent Activity',
            offending: match[0],
            message: `IP breadth claim "${label}" with only ${patentCount} linked patents. Sample can't support breadth/convergence inferences.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Share-normalized gap check. r31 audit's headline finding: the
  // whole gap ranking used raw broader/sample count ratio, ignoring
  // that the two universes have different sizes. Correct signal is
  // broader-share (broader/scopeUniverse) vs sample-share
  // (sample/totalProjects). Flag any ranked gap where broader-share
  // < sample-share (parity or under-broader — not a gap).
  // ------------------------------------------------------------------
  {
    id: 'gap-signal-share-normalized',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const scope = ctx.whiteSpace.scopeUniverseCount
      const total = ctx.whiteSpace.totalProjects
      if (!scope || scope <= 0 || total <= 0) return violations
      for (const op of ctx.whiteSpace.topOpportunities) {
        if (op.broaderNihCount <= 0 || op.sampleCount <= 0) continue
        const broaderShare = op.broaderNihCount / scope
        const sampleShare = op.sampleCount / total
        // If broader-share is not materially larger than sample-share
        // (>=2x), the "gap" is a base-rate artifact.
        if (broaderShare / sampleShare < 2) {
          violations.push({
            ruleId: 'gap-signal-share-normalized',
            severity: 'critical',
            section: 'White Space Analysis',
            offending: `${op.categoryName} (sample-share ${(sampleShare * 100).toFixed(1)}%, broader-share ${(broaderShare * 100).toFixed(1)}%)`,
            message: `Coverage Gap Signal "${op.categoryName}" has broader-share ${(broaderShare * 100).toFixed(2)}% only ${(broaderShare / sampleShare).toFixed(2)}x sample-share ${(sampleShare * 100).toFixed(2)}%. Not a gap - parity or over-represented in sample.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Trial-status arithmetic reconciliation. When narrative cites two
  // of (active, terminated, other), the sum must reconcile against
  // the total.
  // ------------------------------------------------------------------
  {
    id: 'trial-status-sum-reconciles',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const total = ctx.agentOutputs.trials.items.length
      // Look for a sentence citing "N active/completed" and "M terminated"
      // and check that N + M ~= total (allowing residual up to 5).
      const activeMatch = ctx.markdown.match(
        /(\d{1,4})\s+(?:linked )?(?:clinical )?trials?\s+(?:are\s+)?active or completed/i,
      )
      const termMatch = ctx.markdown.match(
        /(\d{1,4})\s+are\s+terminated(?:,\s*suspended)?(?:,?\s*(?:or|and)\s*withdrawn)?/i,
      )
      if (activeMatch && termMatch) {
        const active = parseInt(activeMatch[1], 10)
        const term = parseInt(termMatch[1], 10)
        const sum = active + term
        if (Math.abs(sum - total) > 5) {
          violations.push({
            ruleId: 'trial-status-sum-reconciles',
            severity: 'warning',
            section: null,
            offending: `${active} active + ${term} terminated = ${sum} ≠ ${total} total`,
            message: `Narrative cites ${active} active + ${term} terminated = ${sum}, but total is ${total}. Missing residual of ${total - sum} trials in another status.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "assay attrition" and similar unsupported causal attributions.
  // ------------------------------------------------------------------
  {
    id: 'no-unsupported-causal-attribution',
    severity: 'warning',
    check(ctx) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bassay attrition\b/i, label: 'assay attrition' },
        {
          regex: /\bsignal of (assay|technology) (failure|attrition)\b/i,
          label: 'signal of assay/tech failure',
        },
      ]
      const violations: LintViolation[] = []
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-unsupported-causal-attribution',
            severity: 'warning',
            section: null,
            offending: match[0],
            message: `"${label}" attributes trial termination to a specific cause without corroborating data. Terminations reflect enrollment, funding, or PI departure at least as often as assay failure.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Widened prescriptive-targeting: catches "scout X institutions",
  // "identify partners", "natural consortium partners" etc.
  // ------------------------------------------------------------------
  {
    id: 'no-prescriptive-set-targeting',
    severity: 'warning',
    check(ctx, sections) {
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bscout collaborator institutions\b/i, label: 'scout collaborator institutions' },
        { regex: /\bscout collaborators?\b/i, label: 'scout collaborators' },
        {
          regex: /\bidentify (potential|natural) (consortium |collaboration )?partners\b/i,
          label: 'identify (potential/natural) partners',
        },
        {
          regex: /\bnatural (co-investigator|consortium) partners\b/i,
          label: 'natural co-investigator/consortium partners',
        },
        {
          regex: /\bconsortium partners\b/i,
          label: 'consortium partners',
        },
        {
          regex: /\bengage with (the )?leading nodes\b/i,
          label: 'engage with leading nodes',
        },
      ]
      const violations: LintViolation[] = []
      const target = ['Next Steps', 'Research Positioning', 'White Space Analysis']
      for (const sectionName of target) {
        const body = sections.get(sectionName) || ''
        for (const { regex, label } of patterns) {
          const match = body.match(regex)
          if (match) {
            violations.push({
              ruleId: 'no-prescriptive-set-targeting',
              severity: 'warning',
              section: sectionName,
              offending: match[0],
              message: `Prescriptive set-targeting "${label}" in ${sectionName}. Rewrite as self-directed research ("run a RePORTER search yourself") not targeting-of-community.`,
            })
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Duplicate Market Context bullets. Fuzzy-match on meaningful word
  // set — Jaccard >= 0.5 = likely dup.
  // ------------------------------------------------------------------
  {
    id: 'no-duplicate-market-bullets',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const marketBody = sections.get('Market Context') || ''
      if (!marketBody) return violations
      // Extract bulleted lines starting with a YYYY-MM prefix.
      const bullets = (marketBody.match(/^\s*(?:-|\*)\s*\d{4}-\d{2}\s*:[^\n]+/gm) || [])
      const STOP = new Set([
        'the', 'and', 'for', 'with', 'from', 'this', 'that', 'has', 'have',
        'been', 'are', 'was', 'were', 'will', 'would', 'could', 'may',
        'trial', 'trials', 'test', 'tests', 'study', 'studies',
      ])
      const sigs = bullets.map((b) => {
        const body = b.replace(/^\s*(?:-|\*)\s*\d{4}-\d{2}\s*:\s*/, '')
        return {
          bullet: b.trim(),
          sig: new Set(
            (body.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)),
          ),
        }
      })
      for (let i = 0; i < sigs.length; i++) {
        for (let j = i + 1; j < sigs.length; j++) {
          const a = sigs[i].sig
          const b = sigs[j].sig
          if (a.size === 0 || b.size === 0) continue
          let intersect = 0
          for (const w of a) if (b.has(w)) intersect++
          const union = a.size + b.size - intersect
          const jaccard = union > 0 ? intersect / union : 0
          if (jaccard >= 0.5) {
            violations.push({
              ruleId: 'no-duplicate-market-bullets',
              severity: 'warning',
              section: 'Market Context',
              offending: sigs[j].bullet.slice(0, 120),
              message: `Duplicate market bullet (Jaccard ${jaccard.toFixed(2)}): "${sigs[j].bullet.slice(0, 80)}..." near-duplicates an earlier bullet.`,
            })
            break
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "N terminations" count-label mismatch. r32 audit found narrative
  // saying "15 trial terminations" when the Status table showed
  // 10 Terminated + 4 Suspended + 1 Withdrawn = 15 in total, but
  // "terminations" specifically maps to the Terminated status alone.
  // ------------------------------------------------------------------
  {
    id: 'terminations-count-label-mismatch',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const terminatedOnly = ctx.agentOutputs.trials.items.filter(
        (t) => (t.study_status || '').toLowerCase().trim() === 'terminated',
      ).length
      // Look for "N trial terminations" or "N terminations" claims.
      const pattern = /(\d{1,4})\s+(?:trial\s+)?terminations?\b/gi
      let m: RegExpExecArray | null
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        const claimed = parseInt(m[1], 10)
        if (claimed !== terminatedOnly) {
          violations.push({
            ruleId: 'terminations-count-label-mismatch',
            severity: 'warning',
            section: null,
            offending: m[0],
            message: `"${m[0]}" but only ${terminatedOnly} trials have study_status=Terminated. The other status labels (Suspended, Withdrawn) are different — say "terminated/suspended/withdrawn" if that's the combined bucket.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Non-exclusive share double-count: "collectively represent X%" from
  // a sum of non-exclusive rows is arithmetically wrong. Detect
  // "collectively represent \d+%" or "top N categories hold M/K"
  // in coverage-table-adjacent context.
  // ------------------------------------------------------------------
  {
    id: 'no-nonexclusive-share-double-count',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const patterns: Array<{ regex: RegExp; label: string }> = [
        {
          regex: /\bcollectively represent\s+(?:approximately\s+|roughly\s+|about\s+)?\d+(?:\.\d+)?%\s+of the (?:\d+-project |)sample\b/i,
          label: 'collectively represent X% of the sample',
        },
        {
          regex: /\btop\s+\d+\s+categories\s+(?:hold|represent|account for)\s+\d+\/\d+\s+matched\b/i,
          label: 'top N categories hold M/K matched projects',
        },
      ]
      for (const { regex, label } of patterns) {
        const match = ctx.markdown.match(regex)
        if (match) {
          violations.push({
            ruleId: 'no-nonexclusive-share-double-count',
            severity: 'critical',
            section: 'White Space Analysis',
            offending: match[0],
            message: `"${label}" summed non-exclusive category rows. Coverage table rows overlap (a project can appear in multiple categories); their sum expressed as a share is a double-count.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // PI possessive references in narrative. r33 audit flagged
  // "Velculescu's DELFI work" in a project card insight - the PI is
  // structured metadata on the card, so a possessive reference in the
  // prose is a duplicate + narrative callout. Extract PI surnames from
  // topResearchers and detect [Surname]'s constructions anywhere in
  // the markdown.
  // ------------------------------------------------------------------
  {
    id: 'no-pi-possessive-in-narrative',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const surnames = new Set<string>()
      for (const r of ctx.topResearchers.slice(0, 50)) {
        const parts = (r.pi_name || '').split(',')
        const surname = parts[0]?.trim()
        if (surname && surname.length >= 3) surnames.add(surname)
      }
      if (surnames.size === 0) return violations
      const escaped = Array.from(surnames)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')
      const pattern = new RegExp(`\\b(${escaped})['’]s\\s+\\w`, 'gi')
      let m: RegExpExecArray | null
      let count = 0
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        count++
        if (count > 3) break
        violations.push({
          ruleId: 'no-pi-possessive-in-narrative',
          severity: 'warning',
          section: null,
          offending: m[0],
          message: `PI possessive "${m[0]}" appears in narrative. Drop the possessive - PI name lives in structured metadata only.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Institution names as entry points / targets in Competitive
  // Topology Strategic Implications. r33 audit: "primarily UIUC and
  // UConn represent more differentiated entry points" tips from
  // descriptive to prescriptive.
  // ------------------------------------------------------------------
  {
    id: 'no-institutions-as-entry-points',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const topology = sections.get('Competitive Topology') || ''
      if (!topology) return violations
      // Find Strategic Implications subsection.
      const siMatch = topology.match(/### Strategic Implications[\s\S]*?(?=\n##|$)/)
      const siBody = siMatch ? siMatch[0] : ''
      if (!siBody) return violations
      // Look for institutional acronyms/names co-occurring with entry-
      // point/target/differentiated words within a short span.
      const orgTokens = /(?:UIUC|UConn|MGH|MIT|UCSF|UCLA|UC\s+\w+|Cornell|Harvard|Stanford|Johns Hopkins|Yale|Duke|Penn|Columbia|NYU|MSKCC|Mayo|Broad|Vanderbilt|Fred Hutch|Dana-?Farber|Sloan Kettering|Weill|Beckman|City of Hope)/i
      const targetVerbs =
        /\b(entry point|entry points|represent (?:more )?differentiated|differentiated entry|target|targets|target for|choose|prioritize|primarily [A-Z])/i
      const orgMatch = siBody.match(orgTokens)
      const verbMatch = siBody.match(targetVerbs)
      if (orgMatch && verbMatch) {
        // Both present in the SI - flag. This is not a perfect co-
        // occurrence test but it fires on the exact pattern r33 hit.
        violations.push({
          ruleId: 'no-institutions-as-entry-points',
          severity: 'warning',
          section: 'Competitive Topology → Strategic Implications',
          offending: `${orgMatch[0]} + ${verbMatch[0]}`,
          message: `Competitive Topology Strategic Implications names an institution ("${orgMatch[0]}") in an entry-point/target context ("${verbMatch[0]}"). Rewrite - keep institution names in the clusters keyPlayers list only, not in the SI recommendation.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // White Space Strategic Implications naming sub-30 broader-NIH
  // categories as targets. r33 audit: "tissue-of-origin (1 project),
  // high-risk surveillance (2 projects)" cited as R21 anchors despite
  // broader-NIH=6 and 19 (below the 30 floor). Check that any category
  // named in the SI paragraph is in the ranked-opportunities list.
  // ------------------------------------------------------------------
  {
    id: 'white-space-si-ranked-only',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const wsBody = sections.get('White Space Analysis') || ''
      const siMatch = wsBody.match(/### Strategic Implications[\s\S]*?(?=\n##|$)/)
      const siBody = siMatch ? siMatch[0] : ''
      if (!siBody) return violations
      const rankedNames = new Set(
        ctx.whiteSpace.topOpportunities.map((op) => op.categoryName.toLowerCase()),
      )
      // Also collect category names from ALL dimensions to detect which
      // are being referenced.
      const allCats: string[] = []
      for (const dim of ctx.whiteSpace.dimensions) {
        for (const cat of dim.categories) {
          allCats.push(cat.name)
        }
      }
      for (const catName of allCats) {
        if (catName.length < 6) continue // skip very short names
        if (rankedNames.has(catName.toLowerCase())) continue
        // Check if this un-ranked category is named in the SI body.
        // Use word-boundary match against a normalized version.
        const escaped = catName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`, 'i')
        if (re.test(siBody)) {
          // Find the underlying category to get broader-NIH count.
          const cat = ctx.whiteSpace.dimensions
            .flatMap((d) => d.categories)
            .find((c) => c.name === catName)
          if (cat && cat.broaderNihCount > 0 && cat.broaderNihCount < 30) {
            violations.push({
              ruleId: 'white-space-si-ranked-only',
              severity: 'warning',
              section: 'White Space → Strategic Implications',
              offending: `${catName} (broader-NIH=${cat.broaderNihCount})`,
              message: `White Space SI names "${catName}" (broader-NIH ${cat.broaderNihCount}, below 30 floor) but it's not in the ranked opportunities. Strategic Implications must draw only from the ranked list.`,
            })
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Sample-share-to-structural inference. Pattern: "N% of sample" +
  // proximity to "limited", "underfunded", "relative to translational
  // volume", "mechanistic investigation". Turns a sample share into a
  // field-level structural claim.
  // ------------------------------------------------------------------
  {
    id: 'no-sample-share-to-structural',
    // Upgraded from 'warning' to 'critical' (r41): every external
    // audit that finds this pattern classifies it as a Dimension 3
    // fail, and it needs to trigger retry to reformulate the
    // sentence.
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Look for the pattern within a short window.
      const patterns = [
        /\d+(?:\.\d+)?%[^.]{0,120}\b(?:limited (?:mechanistic |mechanism |basic |fundamental )?(?:investigation|work|research)|underfunded|structural(?:ly)?)\b/i,
        /\b(?:limited (?:mechanistic |mechanism |basic |fundamental )?(?:investigation|work|research)|underfunded|structural(?:ly)?)[^.]{0,120}\d+(?:\.\d+)?%/i,
        /\brelative to (?:the )?translational volume\b/i,
        // r36: "that mechanistic gap may constrain sensitivity improvements"
        /\b(?:that|this|the)\s+(?:mechanistic|methodological|discovery)\s+gap\s+may\s+(?:constrain|limit|prevent|hinder|delay)\b/i,
        /\bmay\s+constrain\s+(?:sensitivity|specificity|clinical|analytical)\s+(?:improvements|advances|gains)\b/i,
        // r37: softer sample-share -> field-inference pattern.
        // "5 projects (4.1%), suggesting mechanistic work on cfDNA
        //  biogenesis is thin in this sample" - the "thin ... suggesting"
        // + share pair reads as a field-level judgment.
        /\d+(?:\.\d+)?%\s*[^.]{0,80}?\bsuggest(?:s|ing)?\b[^.]{0,80}?\b(?:thin|sparse|limited|underrepresented|scarce|meager|missing)\b/i,
        /\b(?:thin|sparse|scarce|meager)\s+(?:in|within)\s+(?:this\s+)?sample[^.]{0,120}?\bsuggest(?:s|ing)?\b/i,
        /\bsuggest(?:s|ing)?\s+(?:mechanistic|methodological|discovery)\s+work\s+(?:on|into)?[^.]{0,60}?\b(?:thin|sparse|limited)\b/i,
      ]
      for (const regex of patterns) {
        const match = ctx.markdown.match(regex)
        if (match && match.index !== undefined) {
          // Attribute to the containing section so retry can rewrite
          // it. Walk backward from the match to find the nearest
          // `## Heading` and use that as the section name. r41 audit
          // flagged this pattern in Exec Summary but retry didn't fire
          // because section was null.
          const before = ctx.markdown.slice(0, match.index)
          const headingMatch = before.match(/##\s+([^\n]+)$/m)
          const section = headingMatch ? headingMatch[1].trim() : null
          violations.push({
            ruleId: 'no-sample-share-to-structural',
            severity: 'critical',
            section,
            offending: match[0].slice(0, 160),
            message:
              'Sample-share-to-structural inference detected. A low sample % does not support "limited investigation", "underfunded", or "structural" claims. Reframe as observation-in-sample.',
          })
          break
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Trial-status arithmetic reconciliation across sections. r34 audit
  // found Exec Summary saying "54 are active or completed" when the
  // By Status table showed 21 recruiting + 22 completed + 10 active-
  // not-recruiting = 53 (with 1 Not Yet Recruiting dropped into the
  // active/completed bucket). Compute the true active/completed count
  // from the underlying data and reconcile against narrative claims.
  // ------------------------------------------------------------------
  {
    id: 'trial-status-reconciles-across-sections',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const ACTIVE = new Set([
        'active, not recruiting',
        'recruiting',
        'enrolling by invitation',
        'completed',
      ])
      const NOT_YET = new Set(['not yet recruiting', 'approved for marketing'])
      const activeCompleted = ctx.agentOutputs.trials.items.filter((t) =>
        ACTIVE.has((t.study_status || '').toLowerCase().trim()),
      ).length
      const notYet = ctx.agentOutputs.trials.items.filter((t) =>
        NOT_YET.has((t.study_status || '').toLowerCase().trim()),
      ).length
      // Look for "N are active or completed" narrative claims.
      const pattern =
        /(\d{1,4})\s+(?:linked )?(?:clinical )?trials?\s+are\s+active or completed/gi
      let m: RegExpExecArray | null
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        const claimed = parseInt(m[1], 10)
        // If the narrative claims MORE than the true active/completed
        // count, and the excess matches the not-yet count, they've
        // incorrectly lumped NYR trials into "active or completed".
        if (claimed === activeCompleted + notYet && notYet > 0) {
          violations.push({
            ruleId: 'trial-status-reconciles-across-sections',
            severity: 'critical',
            section: null,
            offending: m[0],
            message: `"${m[0]}" appears to lump ${notYet} "Not Yet Recruiting" trial(s) into "active or completed". True active/completed count is ${activeCompleted}; NYR is ${notYet}. Cite them separately.`,
          })
        } else if (claimed !== activeCompleted) {
          violations.push({
            ruleId: 'trial-status-reconciles-across-sections',
            severity: 'critical',
            section: null,
            offending: m[0],
            message: `"${m[0]}" doesn't reconcile with ${activeCompleted} active/completed trials in the underlying data.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "hub" / "entry point" / "access node" framing near institution
  // name. r34 flagged "MGH functions as a methodologically diverse hub"
  // and "U2C infrastructure grants at MGH and Pittsburgh as collaboration
  // entry points". Prescriptive-callout detection needs to include
  // infrastructure/collaboration nouns.
  // ------------------------------------------------------------------
  {
    id: 'no-hub-entry-point-framing',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      // Look for "[hub|entry point|access node|resource node|gateway|on-ramp]"
      // within 30 chars of an institution acronym/name.
      const orgTokens =
        '(?:UIUC|UConn|MGH|MIT|UCSF|UCLA|UC\\s+\\w+|Cornell|Harvard|Stanford|Johns\\s+Hopkins|Yale|Duke|Penn|Columbia|NYU|MSKCC|Mayo|Broad|Vanderbilt|Fred\\s+Hutch|Dana-?Farber|Sloan\\s+Kettering|Weill|Beckman|City\\s+of\\s+Hope|Baylor|Pittsburgh)'
      const framingTokens =
        '(?:hub|entry\\s+point|entry\\s+points|access\\s+node|access\\s+nodes|resource\\s+node|resource\\s+nodes|gateway|on-ramp|portal)'
      const orgFirst = new RegExp(`${orgTokens}[\\s\\S]{0,60}${framingTokens}`, 'i')
      const framingFirst = new RegExp(`${framingTokens}[\\s\\S]{0,60}${orgTokens}`, 'i')
      const m1 = ctx.markdown.match(orgFirst)
      if (m1) {
        violations.push({
          ruleId: 'no-hub-entry-point-framing',
          severity: 'warning',
          section: null,
          offending: m1[0].slice(0, 120),
          message: `Institution name + hub/entry-point framing detected: "${m1[0].slice(0, 80)}...". Rewrite as factual concentration without the "hub" / "entry point" modifier.`,
        })
      } else {
        const m2 = ctx.markdown.match(framingFirst)
        if (m2) {
          violations.push({
            ruleId: 'no-hub-entry-point-framing',
            severity: 'warning',
            section: null,
            offending: m2[0].slice(0, 120),
            message: `Hub/entry-point + institution framing detected: "${m2[0].slice(0, 80)}...". Rewrite as factual concentration.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "structural [claim-noun]" - the modifier implies a permanent
  // property the sample can't support. r34 flagged "structural
  // competitive risks that could reshape the field" in Market Context.
  // ------------------------------------------------------------------
  {
    id: 'no-structural-modifier',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      // Post-render substitution should have stripped these. If the
      // regex still fires, either the substitution missed a variant or
      // the input is stale.
      const pattern =
        /\bstructural(?:ly)?\s+(competitive risks?|shifts?|changes?|risks?|barriers?|advantages?|dynamics?|underfunding)\b/i
      const m = ctx.markdown.match(pattern)
      if (m) {
        violations.push({
          ruleId: 'no-structural-modifier',
          severity: 'warning',
          section: null,
          offending: m[0],
          message: `"structural" modifier applied to a field-level claim ("${m[0]}"). Drop "structural" - a market-context observation can't support the permanence implied by that modifier.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Org table caption "Top N of M" must match actual rendered row
  // count. r34 audit claimed the caption said "Top 15" while table
  // listed 14 rows. Compute actual rows by counting pipe-delimited
  // rows under the "## Key Organizations" section and verify N matches.
  // ------------------------------------------------------------------
  {
    id: 'org-table-caption-matches-rows',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const body = sections.get('Key Organizations') || ''
      if (!body) return violations
      const captionMatch = body.match(
        /\*Top\s+(\d+)\s+of\s+(\d+)\s+funded organizations/i,
      )
      if (!captionMatch) return violations
      const captionN = parseInt(captionMatch[1], 10)
      // Count table data rows (skip header + divider).
      const rowLines = body
        .split('\n')
        .filter((l) => l.trim().startsWith('|') && !l.includes('---'))
      // Subtract 1 for the header row.
      const actualRows = Math.max(0, rowLines.length - 1)
      if (captionN !== actualRows) {
        violations.push({
          ruleId: 'org-table-caption-matches-rows',
          severity: 'warning',
          section: 'Key Organizations',
          offending: `caption says Top ${captionN} but ${actualRows} row(s) rendered`,
          message: `Org table caption "Top ${captionN} of ${captionMatch[2]}" doesn't match ${actualRows} rendered rows. Fix caption to match.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Named commercial products cited single-sided. r34 flagged DELFI
  // presented as "planned prospective validation particularly well-
  // timed" without acknowledging real-world specificity/PPV concerns.
  // Detect named MCED/liquid-biopsy products and check whether the
  // surrounding text acknowledges any negative-side language.
  // ------------------------------------------------------------------
  {
    id: 'named-product-single-sided',
    // Upgraded to critical (r43): Dimension 2 is a repeat fail
    // and the retry pipeline needs to see this violation.
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const products = [
        'DELFI',
        'DELFI Diagnostics',
        'Galleri',
        'GRAIL Galleri',
        'Shield',
        'Guardant Shield',
        'Freenome',
        'Cologuard',
        'Signatera',
        'MRDetect',
        'EFIRM',
        'Vanguard',
        'PATHFINDER',
        'NHS-Galleri',
      ]
      const positiveTokens =
        /(well-timed|positive|robust|strong performance|approved|breakthrough|leading|first-in-class|validated|state-of-the-art)/i
      const negativeAckTokens =
        /(specificity|ppv|coverage denial|coverage denials|caveat|missed(?:\s+primary)?|primary endpoint|underperform|scrutiny|concerns?|delay|delayed|pma|challenges?|still developing|remains? developing|unresolved)/i
      for (const product of products) {
        const escaped = product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${escaped}\\b`, 'gi')
        let m: RegExpExecArray | null
        while ((m = re.exec(ctx.markdown)) !== null) {
          // Look at a 400-char window around the match.
          const start = Math.max(0, m.index - 200)
          const end = Math.min(ctx.markdown.length, m.index + 200)
          const window = ctx.markdown.slice(start, end)
          if (positiveTokens.test(window) && !negativeAckTokens.test(window)) {
            // Attribute to the containing section so retry can fire.
            const before = ctx.markdown.slice(0, m.index)
            const headingMatch = before.match(/##\s+([^\n]+)$/m)
            const section = headingMatch ? headingMatch[1].trim() : null
            violations.push({
              ruleId: 'named-product-single-sided',
              severity: 'critical',
              section,
              offending: window.slice(150, 250),
              message: `Named product "${product}" cited with positive framing but no acknowledgment of specificity/PPV/coverage concerns within 200-char window. Either cite both sides or restrict mention to factual description.`,
            })
            // One violation per product is enough to flag; move on.
            break
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "N active or completed" phrasing banned entirely. r35 audit
  // showed this label is ambiguous - readers disagree on whether
  // "recruiting" counts as "active". Force explicit status
  // enumeration instead.
  // ------------------------------------------------------------------
  {
    id: 'no-active-or-completed-bucket',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const pattern = /\b\d{1,4}\s+(?:linked )?(?:clinical )?trials?\s+(?:are\s+)?active or completed\b/gi
      const match = ctx.markdown.match(pattern)
      if (match) {
        violations.push({
          ruleId: 'no-active-or-completed-bucket',
          severity: 'critical',
          section: null,
          offending: match[0],
          message: `"${match[0]}" uses the ambiguous "active or completed" bucket. Cite each status individually (recruiting, completed, active-not-recruiting, not yet recruiting) or use "in-progress/planned/completed vs terminated/suspended/withdrawn" split.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Trial status enumeration completeness. If narrative cites any
  // status counts (recruiting=X, completed=Y, etc), the cited counts
  // must sum to the total. r36 audit caught Exec Summary citing
  // "20 recruiting, 21 completed, 15 terminated/suspended/withdrawn"
  // = 56 of 67, silently dropping 11 NYR + Active-Not-Recruiting.
  // ------------------------------------------------------------------
  {
    id: 'trial-status-enumeration-complete',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const total = ctx.agentOutputs.trials.items.length
      if (total < 5) return violations
      // Look for a sentence citing recruiting AND (completed OR
      // terminated) with counts — indicating status enumeration.
      // Extract every N-preceded status token, sum them, compare to
      // total.
      const statusPattern =
        /\b(\d{1,4})\s+(?:are\s+)?(recruiting|completed|active[\s,-]+not[\s-]+recruiting|not\s+yet\s+recruiting|terminated(?:,\s*suspended)?(?:,?\s*(?:or|and)\s*withdrawn)?|terminated|suspended|withdrawn|enrolling\s+by\s+invitation)/gi
      // Match sentences (approximate) that enumerate status
      const sentences = ctx.markdown.split(/(?<=[.!?])\s+/)
      for (const s of sentences) {
        const matches = Array.from(s.matchAll(statusPattern))
        if (matches.length < 2) continue // not an enumeration
        let sum = 0
        for (const m of matches) sum += parseInt(m[1], 10)
        // Allow within 2 of total (rounding, "Not Yet Recruiting" as 0).
        if (Math.abs(sum - total) > 2 && sum < total) {
          violations.push({
            ruleId: 'trial-status-enumeration-complete',
            severity: 'critical',
            section: null,
            offending: s.slice(0, 200),
            message: `Sentence enumerates status counts summing to ${sum} but total is ${total}. Missing ${total - sum} trials in another status. Cite the residual explicitly (e.g. "the remaining N are not-yet-recruiting or active-not-recruiting").`,
          })
          if (violations.length >= 2) break
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // "N phase-labeled interventional trials" collapse. r35 caught this
  // in Field Maturity Strategic Implications - implies phase-labeled
  // = interventional 1:1 when the counts differ.
  // ------------------------------------------------------------------
  {
    id: 'no-phase-labeled-interventional-collapse',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Match "N phase-labeled interventional" without an intervening
      // "subset of" qualifier that would make it correct.
      const pattern = /\b\d{1,3}\s+phase-labeled\s+interventional\s+(?:trials?)?\b/gi
      let m: RegExpExecArray | null
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        // Look at the surrounding 100 chars for a "subset of" qualifier.
        const start = Math.max(0, m.index - 100)
        const end = Math.min(ctx.markdown.length, m.index + m[0].length + 100)
        const window = ctx.markdown.slice(start, end)
        if (!/subset of|phased subset/i.test(window)) {
          violations.push({
            ruleId: 'no-phase-labeled-interventional-collapse',
            severity: 'critical',
            section: null,
            offending: m[0],
            message: `"${m[0]}" collapses "phase-labeled" and "interventional" into 1:1 identity. Rewrite as "the phased subset of N interventional trials" so the reader can see the phase-labeled count is a subset.`,
          })
          break
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Cluster / clustering language in Patent section when patents<10.
  // r35 caught "the protected innovations cluster around nucleic acid
  // detection" in Patent Analysis narrative.
  // ------------------------------------------------------------------
  {
    id: 'no-cluster-in-patent-when-insufficient',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      if (patentCount >= 10) return violations
      const body = sections.get('Patent Activity') || ''
      if (!body) return violations
      const cleaned = body.replace(/a landscape label like[\s\S]*?to be meaningful/gi, '')
      const pattern = /\b(clusters? around|clustered|clustering|cluster of)\b/i
      const m = cleaned.match(pattern)
      if (m) {
        violations.push({
          ruleId: 'no-cluster-in-patent-when-insufficient',
          severity: 'critical',
          section: 'Patent Activity',
          offending: m[0],
          message: `"${m[0]}" is a clustering claim in Patent narrative with only ${patentCount} linked patents. Contradicts the insufficient-sample header.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Percentages on a small patent base. r35 caught "63% academic,
  // 25% top assignee" reported on an 8-patent base.
  // ------------------------------------------------------------------
  {
    id: 'no-percentages-in-patent-when-insufficient',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      if (patentCount >= 10) return violations
      const body = sections.get('Patent Activity') || ''
      if (!body) return violations
      // Look for a percentage adjacent to descriptor words like
      // "academic", "assignee", "held by", "commercial".
      const pattern =
        /\d{1,3}(?:\.\d+)?%\s+(?:from\s+)?(?:academic|academic institutions|assignees?|commercial|university|universities|top assignee|held by|classify as)/i
      const m = body.match(pattern)
      if (m) {
        violations.push({
          ruleId: 'no-percentages-in-patent-when-insufficient',
          severity: 'warning',
          section: 'Patent Activity',
          offending: m[0],
          message: `"${m[0]}" reports a distribution percentage on ${patentCount} patents. Cite raw counts only ("6 of ${patentCount} are academic") - percentages on a small base imply distribution shape the sample can't support.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Widened target-noun ban. r35 flagged pervasive "partnership target"
  // / "collaboration target" framing. Also catches "engagement target".
  // ------------------------------------------------------------------
  {
    id: 'no-target-noun-forms',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\b(?:high-value\s+)?partnership targets?\b/i, label: 'partnership target(s)' },
        { regex: /\b(?:high-value\s+)?collaboration targets?\b/i, label: 'collaboration target(s)' },
        { regex: /\bengagement targets?\b/i, label: 'engagement target(s)' },
        { regex: /\btargets? for collaboration\b/i, label: 'targets for collaboration' },
        { regex: /\bcandidate (?:partners?|collaborators?|consortium)\b/i, label: 'candidate partner/collaborator' },
      ]
      for (const { regex, label } of patterns) {
        const m = ctx.markdown.match(regex)
        if (m) {
          violations.push({
            ruleId: 'no-target-noun-forms',
            severity: 'warning',
            section: null,
            offending: m[0],
            message: `Prescriptive "target" noun form "${label}" detected. Rewrite as pattern-level observation without directing the reader to a group to pursue.`,
          })
          break
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Overlapping subtotals in same passage. r37 audit caught Exec
  // Summary saying "15 terminated, suspended, or withdrawn ...
  // terminated and suspended trials (12 combined)" - both correct but
  // citing two overlapping subtotals of the same base reads as a
  // contradiction.
  // ------------------------------------------------------------------
  {
    id: 'no-overlapping-status-subtotals',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      // Look for passages (sentence + next sentence) that cite BOTH
      // (T+S+W) and (T+S) or (S+W) or (T+W) in overlapping form.
      // Simple detection: find "N terminated, suspended, (or|and) withdrawn"
      // AND within 200 chars "M combined" or "M ... terminated (and|or) suspended"
      const twswPattern = /\b(\d{1,4})\s+terminated,\s*suspended,?\s*(?:or|and)\s+withdrawn/i
      const tsCombined = /\b(\d{1,4})\s+combined\b|\b(\d{1,4})\s+terminated\s+(?:and|or)\s+suspended\b/i
      const twsw = ctx.markdown.match(twswPattern)
      if (twsw) {
        // Look at 200 chars after the match for a subset citation.
        const start = twsw.index || 0
        const window = ctx.markdown.slice(start, start + 400)
        const ts = window.match(tsCombined)
        if (ts) {
          violations.push({
            ruleId: 'no-overlapping-status-subtotals',
            severity: 'critical',
            section: null,
            offending: `${twsw[0]} ... ${ts[0]}`,
            message: `Overlapping status subtotals cited in same passage: "${twsw[0]}" (T+S+W) and "${ts[0]}" (T+S or overlapping subset). Both may be correct in isolation but citing two subtotals of the same base reads as contradiction. Pick one framing.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Orphan trial denominator. r37 audit caught Clinical Validation
  // Status narrative saying "among the 25 reviewed trials" when the
  // actual sample is 69 trials. Any "N trials" citation in narrative
  // must map to a value derivable from the underlying data.
  // ------------------------------------------------------------------
  {
    id: 'no-orphan-trial-denominator',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const trials = ctx.agentOutputs.trials.items
      const total = trials.length
      if (total === 0) return violations
      const observational = trials.filter(
        (t) => (t.study_type || '').toUpperCase() === 'OBSERVATIONAL',
      ).length
      const interventional = trials.filter(
        (t) => (t.study_type || '').toUpperCase() === 'INTERVENTIONAL',
      ).length
      // Compute the set of legitimate trial-count denominators from
      // the data. Any narrative citation of a trial count MUST match
      // one of these values (or be a phase-status count, which we
      // don't fully model here).
      const validCounts = new Set<number>([
        total,
        observational,
        interventional,
      ])
      // Also allow phase-labeled + individual status counts.
      const trialPhases = ctx.agentOutputs.trials.byPhase
      for (const v of Object.values(trialPhases)) validCounts.add(v)
      const trialStatuses = ctx.agentOutputs.trials.byStatus || {}
      for (const v of Object.values(trialStatuses)) validCounts.add(v)
      // Look for "N trials" claims (integer + word "trials" within 3 words).
      const pattern =
        /\b(?:among|of|the|these|those|reviewed|analyzed)\s+(?:the\s+)?(\d{1,4})\s+(?:linked |analyzed |reviewed |eligible )?trials?\b/gi
      let m: RegExpExecArray | null
      const seen = new Set<number>()
      while ((m = pattern.exec(ctx.markdown)) !== null) {
        const n = parseInt(m[1], 10)
        if (seen.has(n)) continue
        seen.add(n)
        if (n <= 3) continue // very small numbers OK (e.g. "the 3 EV trials")
        if (!validCounts.has(n)) {
          // Allow within-2 rounding (e.g. cited 68 vs actual 69).
          let found = false
          for (const v of validCounts) {
            if (Math.abs(v - n) <= 2) {
              found = true
              break
            }
          }
          if (!found) {
            violations.push({
              ruleId: 'no-orphan-trial-denominator',
              severity: 'critical',
              section: null,
              offending: m[0],
              message: `"${m[0]}" cites a trial count of ${n} which doesn't map to any subset in the underlying data (total=${total}, observational=${observational}, interventional=${interventional}, plus phase/status counts). Orphan denominator - probably a hallucinated subset.`,
            })
            if (violations.length >= 2) break
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // PI-possessive in Next Steps. r37 caught "read their funded
  // abstracts" in a Next Steps checklist item - after pointing to
  // the Key Researchers table, the downstream "their X" treats the
  // researcher set as an action target.
  // ------------------------------------------------------------------
  {
    id: 'no-their-referring-to-researchers-in-next-steps',
    severity: 'warning',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const body = sections.get('Next Steps') || ''
      if (!body) return violations
      // Look for "their [noun]" patterns where the noun is a
      // researcher-artifact word.
      const pattern =
        /\btheir\s+(?:funded\s+)?(?:abstracts?|publications?|approaches?|methods?|portfolios?|trajector(?:y|ies)|work)\b/i
      const m = body.match(pattern)
      if (m) {
        violations.push({
          ruleId: 'no-their-referring-to-researchers-in-next-steps',
          severity: 'warning',
          section: 'Next Steps',
          offending: m[0],
          message: `"${m[0]}" in Next Steps uses possessive "their" referring back to a researcher set - reads as directing action at named individuals. Rewrite to point at the artifact ("the funded abstracts in your methodological category") not the people.`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Enumeration count vs actual list. r37 caught FTO saying "four
  // distinct technical areas" then enumerating five items.
  // ------------------------------------------------------------------
  {
    id: 'enumeration-count-matches-list',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const NUM_WORDS: Record<string, number> = {
        two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      }
      // Match "N distinct [technical areas|clusters|categories|assignees|approaches|methods]"
      // followed by a colon or enumeration list.
      const claimPattern =
        /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+distinct\s+(technical areas|clusters|categories|assignees|approaches|methods|technical clusters)\b[^.:]*(?:including|:|such as)\s+([\s\S]{0,400}?)(?:[.:]|$)/i
      const m = ctx.markdown.match(claimPattern)
      if (m) {
        const claimedRaw = m[1].toLowerCase()
        const claimed = NUM_WORDS[claimedRaw] || parseInt(claimedRaw, 10)
        const listText = m[3]
        // Count enumeration items separated by commas or semicolons.
        const items = listText
          .split(/[,;]|\band\b/i)
          .map((s) => s.trim())
          .filter((s) => s.length > 3 && !/^[a-z\s]{0,10}$/i.test(s))
        // Rough sanity: if listed count differs from claimed by >0,
        // that's a mismatch.
        if (items.length > 0 && Math.abs(items.length - claimed) >= 1) {
          violations.push({
            ruleId: 'enumeration-count-matches-list',
            severity: 'warning',
            section: null,
            offending: m[0].slice(0, 200),
            message: `Claim of ${claimed} distinct items but enumeration lists ~${items.length}. Update the count or drop it.`,
          })
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Phase-table reconciliation. Every phase count in the byPhase
  // table should sum to the total, and the split between "observational
  // (N/A by design)" + "interventional (some phase-labeled, some not)"
  // must reconcile against the phase table's N/A + Unknown counts.
  // r42 audit surfaced Phase 1 (2) + Phase 2 (6) + N/A (55) + Unknown
  // (2) = 65 but 44 observational + 12 unlabeled interventional = 56
  // not 57 - one trial's classification is inconsistent between
  // ClinicalTrials.gov's study_type and phase fields.
  // ------------------------------------------------------------------
  {
    id: 'trial-phase-table-reconciles',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const trials = ctx.agentOutputs.trials.items
      if (trials.length === 0) return violations
      const byPhase = ctx.agentOutputs.trials.byPhase || {}
      const phaseSum = Object.values(byPhase).reduce((s, n) => s + n, 0)
      if (phaseSum !== trials.length) {
        violations.push({
          ruleId: 'trial-phase-table-reconciles',
          severity: 'warning',
          section: 'Clinical Validation Status',
          offending: `phase-table sum=${phaseSum} vs trials.items.length=${trials.length}`,
          message: `byPhase counts sum to ${phaseSum} but there are ${trials.length} trials. Discrepancy of ${trials.length - phaseSum} - phase table is out of sync with the items list.`,
        })
      }
      const observational = trials.filter(
        (t) => (t.study_type || '').toUpperCase() === 'OBSERVATIONAL',
      ).length
      const interventional = trials.filter(
        (t) => (t.study_type || '').toUpperCase() === 'INTERVENTIONAL',
      ).length
      const interventionalPhased = trials.filter((t) => {
        if ((t.study_type || '').toUpperCase() !== 'INTERVENTIONAL') return false
        const p = (t.phase || '').toLowerCase()
        return p.includes('phase') && !p.includes('n/a') && !p.includes('unknown')
      }).length
      const interventionalUnphased = interventional - interventionalPhased
      const naCount = byPhase['N/A'] || 0
      const unknownCount = byPhase['Unknown'] || 0
      const expectedNaOrUnknown = observational + interventionalUnphased
      if (Math.abs(naCount + unknownCount - expectedNaOrUnknown) > 1) {
        violations.push({
          ruleId: 'trial-phase-table-reconciles',
          severity: 'warning',
          section: 'Clinical Validation Status',
          offending: `N/A(${naCount}) + Unknown(${unknownCount}) = ${naCount + unknownCount} vs obs(${observational}) + interv_unphased(${interventionalUnphased}) = ${expectedNaOrUnknown}`,
          message: `Phase table N/A+Unknown = ${naCount + unknownCount}, but observational + unlabeled-interventional = ${expectedNaOrUnknown}. Off by ${Math.abs(naCount + unknownCount - expectedNaOrUnknown)}. Underlying ClinicalTrials.gov classification may have anomalies (e.g., observational trial with a phase).`,
        })
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Cross-section date consistency for named events. r42 audit caught
  // "2025-01: GRAIL filed PMA" bullet vs "January-February 2026" in
  // Market Overview narrative - same event, different years. Detects
  // events with a MonthName + year token in narrative AND a YYYY-MM
  // prefix bullet on a similar entity elsewhere; flags year mismatch.
  // ------------------------------------------------------------------
  {
    id: 'cross-section-date-consistency',
    severity: 'warning',
    check(ctx) {
      const violations: LintViolation[] = []
      const marketSection = extractSections(ctx.markdown).get('Market Context') || ''
      if (!marketSection) return violations
      // Extract entity anchors + years from narrative "MonthName YYYY"
      // references. Anchors are 2-3 word phrases containing at least
      // one capitalized token (product names, agencies).
      const narrativePattern =
        /\b(GRAIL|Galleri|NHS-Galleri|PATHFINDER|Signatera|Shield|DELFI|MRDetect|Guardant|Freenome|FDA|Exact)[\s\S]{0,80}?\b(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:-(?:January|February|March|April|May|June|July|August|September|October|November|December))?\s+(\d{4})\b/gi
      const narrativeMentions: Array<{ entity: string; year: string; text: string }> = []
      let m: RegExpExecArray | null
      while ((m = narrativePattern.exec(marketSection)) !== null) {
        narrativeMentions.push({ entity: m[1], year: m[2], text: m[0].slice(0, 120) })
      }
      // Extract bullet prefixes with their body's first entity.
      const bulletPattern = /^\s*(?:-|\*)\s*(\d{4})-(\d{2})\s*:\s*([^\n]+)$/gm
      let b: RegExpExecArray | null
      while ((b = bulletPattern.exec(marketSection)) !== null) {
        const [, prefixYear, , body] = b
        const bodyEntity = body.match(
          /\b(GRAIL|Galleri|NHS-Galleri|PATHFINDER|Signatera|Shield|DELFI|MRDetect|Guardant|Freenome|Exact)\b/i,
        )
        if (!bodyEntity) continue
        const entity = bodyEntity[1]
        // Find a narrative mention referencing the same entity with a
        // different year.
        for (const mention of narrativeMentions) {
          if (mention.entity.toLowerCase() === entity.toLowerCase() && mention.year !== prefixYear) {
            violations.push({
              ruleId: 'cross-section-date-consistency',
              severity: 'warning',
              section: 'Market Context',
              offending: `bullet prefix ${prefixYear}-XX for ${entity} vs narrative year ${mention.year} for same entity`,
              message: `Cross-section date mismatch for "${entity}": bullet says ${prefixYear}, narrative says ${mention.year}. One is wrong.`,
            })
            break
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Whole-sample figure mistakenly attributed to a single category.
  // r43 audit found: "concentration of NIH-linked activity in
  // diagnostics (123 projects, $100.9M total)". 123 and $100.9M are
  // the WHOLE sample; Diagnostics is 74 / $64.6M. LLM conflated
  // sample-wide totals with a category subtotal.
  // ------------------------------------------------------------------
  {
    id: 'no-sample-total-as-category',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const totalProjects = ctx.fundingStats.projectCount
      const totalFundingM = ctx.fundingStats.total / 1_000_000
      const categoryNames = new Set(
        ctx.fundingStats.byCategory.map((c) => c.category.toLowerCase()),
      )
      // Also include common category display names (formatted).
      const CATEGORY_ALIASES: Record<string, string[]> = {
        diagnostics: ['diagnostics', 'diagnostic'],
        biotools: ['biotools', 'bio tools'],
        therapeutics: ['therapeutics', 'therapeutic'],
        basic_research: ['basic research'],
        biomarkers: ['biomarkers', 'biomarker'],
        medical_device: ['medical device', 'medical devices'],
        infrastructure: ['infrastructure'],
        training: ['training'],
      }
      // Build category token set from actual data + aliases.
      const categoryTokens = new Set<string>()
      for (const cat of categoryNames) {
        categoryTokens.add(cat)
        const aliases = CATEGORY_ALIASES[cat.replace(/\s+/g, '_')]
        if (aliases) aliases.forEach((a) => categoryTokens.add(a))
      }
      // Look for sentences containing sample-total figures.
      const totalProjectsRegex = new RegExp(
        `\\b${totalProjects}\\s+projects\\b`,
        'gi',
      )
      const totalFundingRegex = new RegExp(
        `\\$${totalFundingM.toFixed(1)}\\s*M\\b`,
        'gi',
      )
      const sentences = ctx.markdown.split(/(?<=[.!?])\s+/)
      for (const s of sentences) {
        if (!(totalProjectsRegex.test(s) || totalFundingRegex.test(s))) continue
        // Reset regex lastIndex for next iteration.
        totalProjectsRegex.lastIndex = 0
        totalFundingRegex.lastIndex = 0
        // Sentence cites a sample-total figure. Is it also naming a
        // single category noun (other than "sample" or "study" or
        // similar general terms)?
        const lowerS = s.toLowerCase()
        for (const cat of categoryTokens) {
          const catRegex = new RegExp(`\\b${cat}\\b`, 'i')
          if (catRegex.test(lowerS)) {
            // Whitelist "the analyzed sample" and similar phrases.
            if (/\b(analyzed sample|sample total|sample-wide|whole sample|full sample)\b/i.test(s)) {
              continue
            }
            violations.push({
              ruleId: 'no-sample-total-as-category',
              severity: 'critical',
              section: null,
              offending: s.slice(0, 200),
              message: `Sentence cites sample-total figures (${totalProjects} projects or $${totalFundingM.toFixed(1)}M) AND names the "${cat}" category. Sample totals aren't category subtotals - "${cat}" is a subset with its own count. Rewrite to attribute the total to the sample explicitly or use the category's actual count.`,
            })
            break
          }
        }
        if (violations.length >= 2) break
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // IP shape claims stated as negations. r43 audit found "no single
  // institution holds a dominant share of even this small sample" in
  // Freedom to Operate - a distribution/concentration claim in
  // negative form. Existing rules banned "concentrated"/"fragmented"
  // as positive assertions but missed the "no single X holds" form.
  // ------------------------------------------------------------------
  {
    id: 'no-negation-shape-claims-insufficient-sample',
    severity: 'critical',
    check(ctx, sections) {
      const violations: LintViolation[] = []
      const patentCount = ctx.agentOutputs.patents.items.length
      if (patentCount >= 10) return violations
      const target = ['Patent Activity', 'Research Positioning']
      const patterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /\bno single (?:institution|assignee|entity|firm|company|player) (?:holds?|dominates?|controls?|owns?)\b/i, label: 'no single X holds/dominates' },
        { regex: /\bnot dominated by\b/i, label: 'not dominated by' },
        { regex: /\bwithout a (?:dominant|clear) (?:owner|assignee|leader)\b/i, label: 'without a dominant owner' },
        { regex: /\ba dominant share\b/i, label: 'a dominant share' },
        { regex: /\bfairly even distribution\b/i, label: 'fairly even distribution' },
      ]
      for (const sectionName of target) {
        const body = sections.get(sectionName) || ''
        if (!body) continue
        const cleaned = body.replace(/a landscape label like[\s\S]*?to be meaningful/gi, '')
        for (const { regex, label } of patterns) {
          const m = cleaned.match(regex)
          if (m) {
            violations.push({
              ruleId: 'no-negation-shape-claims-insufficient-sample',
              severity: 'critical',
              section: sectionName,
              offending: m[0],
              message: `Negation shape claim "${label}" in ${sectionName} on only ${patentCount} linked patents. The negation form still asserts a distribution shape the sample can't support.`,
            })
            break
          }
        }
      }
      return violations
    },
  },

  // ------------------------------------------------------------------
  // Institution names + prescriptive framing in same sentence.
  // r43 audit found "Johns Hopkins, UCLA, Stanford ... holds a
  // disproportionate share of multi-project awards, compressing
  // differentiation space for new entrants". Naming for factual
  // concentration is fine; adding prescriptive framing to the SAME
  // sentence isn't.
  // ------------------------------------------------------------------
  {
    id: 'no-prescriptive-adjacent-to-named-orgs',
    severity: 'critical',
    check(ctx) {
      const violations: LintViolation[] = []
      const orgs = /(?:Johns\s+Hopkins|UCLA|Stanford|MGH|Massachusetts\s+General\s+Hospital|MIT|UCSF|Harvard|Yale|Duke|Penn|Columbia|NYU|MSKCC|Mayo\s+Clinic|Broad|Vanderbilt|Fred\s+Hutch|Dana-?Farber|Sloan\s+Kettering|Weill|Beckman|City\s+of\s+Hope|Baylor|Pittsburgh|UConn|UIUC|USC|UNC|Emory|Ohio\s+State|OHSU|Cornell)/i
      const prescriptive =
        /(?:compress(?:es|ing)?\s+differentiation|differentiation\s+space\s+for\s+new\s+entrants|crowded\s+for\s+(?:new\s+)?entrants|saturated\s+for\s+(?:new\s+)?entrants|opportunity\s+for\s+entrants\s+to|entry\s+points?\s+lie|target(?:s|ing)?\s+(?:the\s+)?differentiation|competitive\s+space\s+is\s+(?:crowded|thin|open))/i
      const sentences = ctx.markdown.split(/(?<=[.!?])\s+/)
      for (const s of sentences) {
        if (orgs.test(s) && prescriptive.test(s)) {
          violations.push({
            ruleId: 'no-prescriptive-adjacent-to-named-orgs',
            severity: 'critical',
            section: null,
            offending: s.slice(0, 240),
            message: `Sentence names an institution AND uses prescriptive framing ("differentiation space", "crowded for entrants", etc.). Naming for concentration is fine; adding a strategic recommendation in the same sentence reads as targeting that specific institution set. Split the sentences.`,
          })
          if (violations.length >= 2) break
        }
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
