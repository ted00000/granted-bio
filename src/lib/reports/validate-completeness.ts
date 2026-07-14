/**
 * Report completeness gate. Runs after markdown assembly, before the
 * report is persisted. Its job: refuse to ship a report where any
 * expected section is missing, empty, or suspiciously thin.
 *
 * Rationale: r51's 3D Spatial Multiomics report shipped with a Market
 * Context section that had only its Overview paragraph — Key Players,
 * Recent Developments, Market Sizing, and Competitive Landscape all
 * silently absent because web_search returned nothing. The renderer
 * emits each sub-section conditionally, so an empty structured field
 * disappears without warning. This gate catches that class of failure.
 *
 * The gate throws instead of returning a soft result. Inngest retries
 * the whole synthesis on error — the user sees a clean "regenerating"
 * state, never a stub.
 */

import type { AllAgentOutputs, FundingStats } from './types'

/**
 * A single failing check. Message names the section and what's missing
 * so the retry log tells us exactly what to fix if the retry also fails.
 */
export interface CompletenessFailure {
  section: string
  reason: string
}

interface CompletenessInput {
  markdown: string
  agentOutputs: AllAgentOutputs
  fundingStats: FundingStats
  reportPersona: 'researcher' | 'investor'
}

/**
 * Extract sections from markdown by `## Heading` boundaries. Includes
 * the heading line in the value.
 */
function extractSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = markdown.split('\n')
  let currentHeading: string | null = null
  let currentLines: string[] = []
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      if (currentHeading !== null) sections.set(currentHeading, currentLines.join('\n'))
      currentHeading = match[1].trim()
      currentLines = [line]
    } else if (currentHeading !== null) {
      currentLines.push(line)
    }
  }
  if (currentHeading !== null) sections.set(currentHeading, currentLines.join('\n'))
  return sections
}

/**
 * Count the non-structural body characters in a section — strips heading
 * lines, table pipes, blockquote markers, bullet dashes, italic caveats.
 * Used to detect "the section exists but has almost no prose."
 */
function bodyCharCount(section: string): number {
  const stripped = section
    .replace(/^##\s+.*$/gm, '')
    .replace(/^###\s+.*$/gm, '')
    .replace(/^\*.*\*$/gm, '') // italic-only caveat lines
    .replace(/^\|.*\|$/gm, '') // table rows
    .replace(/^\s*[-*]\s+/gm, '') // bullet markers
    .replace(/^\s*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length
}

export function validateReportCompleteness(input: CompletenessInput): CompletenessFailure[] {
  const { markdown, agentOutputs, fundingStats, reportPersona } = input
  const sections = extractSections(markdown)
  const failures: CompletenessFailure[] = []

  // ------------------------------------------------------------------
  // Universal: Executive Summary — must exist with substantial prose.
  // ------------------------------------------------------------------
  {
    const s = sections.get('Executive Summary')
    if (!s) failures.push({ section: 'Executive Summary', reason: 'section is missing entirely' })
    else if (bodyCharCount(s) < 600) failures.push({ section: 'Executive Summary', reason: `body only ${bodyCharCount(s)} chars (need >=600)` })
  }

  // ------------------------------------------------------------------
  // Field Maturity Assessment — TRL + narrative + strategic implications.
  // ------------------------------------------------------------------
  {
    const s = sections.get('Field Maturity Assessment')
    if (!s) failures.push({ section: 'Field Maturity Assessment', reason: 'section is missing entirely' })
    else {
      if (bodyCharCount(s) < 800) failures.push({ section: 'Field Maturity Assessment', reason: `body only ${bodyCharCount(s)} chars (need >=800)` })
      if (!/TRL/.test(s)) failures.push({ section: 'Field Maturity Assessment', reason: 'no TRL band cited' })
      if (!/### Strategic Implications/.test(s)) failures.push({ section: 'Field Maturity Assessment', reason: 'Strategic Implications sub-section missing' })
    }
  }

  // ------------------------------------------------------------------
  // Market Context — the r51 3D Spatial failure mode. Requires overview
  // + at least 2 of the 3 structured sub-sections (Key Players / Recent
  // Developments / Competitive Landscape). Sources must have at least
  // one URL (the "NIH RePORTER funding analysis" fallback alone means
  // web_search returned nothing usable).
  // ------------------------------------------------------------------
  {
    const s = sections.get('Market Context')
    if (!s) failures.push({ section: 'Market Context', reason: 'section is missing entirely' })
    else {
      const hasKeyPlayers = /### Key Players/.test(s)
      const hasRecentDev = /### Recent Developments/.test(s)
      const hasCompetitive = /### Competitive Landscape/.test(s)
      const structuredCount = [hasKeyPlayers, hasRecentDev, hasCompetitive].filter(Boolean).length
      if (structuredCount < 2) {
        const missing = [
          !hasKeyPlayers && 'Key Players',
          !hasRecentDev && 'Recent Developments',
          !hasCompetitive && 'Competitive Landscape',
        ].filter(Boolean).join(', ')
        failures.push({
          section: 'Market Context',
          reason: `only ${structuredCount}/3 structured sub-sections rendered (missing: ${missing}). Web search likely returned no results.`,
        })
      }
      // Require at least one URL source, not just the NIH fallback label.
      const sourceUrlCount = (s.match(/\bhttps?:\/\//g) || []).length
      if (sourceUrlCount === 0) {
        failures.push({
          section: 'Market Context',
          reason: 'no live web-search URL in Sources — the "NIH RePORTER" fallback alone means web_search returned nothing usable',
        })
      }
    }
  }

  // ------------------------------------------------------------------
  // Positioning / Signals — the persona-specific narrative section.
  // Researcher reports render "Research Positioning"; investor renders
  // "Investor Signals". Both must have substantive prose.
  // ------------------------------------------------------------------
  {
    const heading = reportPersona === 'investor' ? 'Investor Signals' : 'Research Positioning'
    const s = sections.get(heading)
    if (!s) failures.push({ section: heading, reason: 'section is missing entirely' })
    else if (bodyCharCount(s) < 1000) failures.push({ section: heading, reason: `body only ${bodyCharCount(s)} chars (need >=1000)` })
  }

  // ------------------------------------------------------------------
  // NIH Funding Landscape — insight paragraph + funding table.
  // ------------------------------------------------------------------
  {
    const s = sections.get('NIH Funding Landscape')
    if (!s) failures.push({ section: 'NIH Funding Landscape', reason: 'section is missing entirely' })
    else {
      if (bodyCharCount(s) < 400) failures.push({ section: 'NIH Funding Landscape', reason: `body only ${bodyCharCount(s)} chars (need >=400)` })
      if (!/\| Total Committed Funding \|/.test(s)) failures.push({ section: 'NIH Funding Landscape', reason: 'Funding Summary table missing' })
    }
  }

  // ------------------------------------------------------------------
  // Key Research Projects — requires at least a few projects rendered.
  // ------------------------------------------------------------------
  {
    const s = sections.get('Key Research Projects')
    if (!s) failures.push({ section: 'Key Research Projects', reason: 'section is missing entirely' })
    else {
      // Each project renders as a "####" sub-heading. Require at least 3.
      const projectHeadings = (s.match(/^####\s+/gm) || []).length
      if (projectHeadings < 3) failures.push({ section: 'Key Research Projects', reason: `only ${projectHeadings} projects rendered (need >=3)` })
    }
  }

  // ------------------------------------------------------------------
  // Clinical section — ALWAYS required now (r51 audit). Even with 0
  // trials, the section renders an explicit empty-state notice
  // explaining both possibilities (pre-clinical field vs. NIH-linkage
  // filter under-counting). The section title varies by top funding
  // category, so check all possible headings.
  // ------------------------------------------------------------------
  {
    const CLINICAL_SECTION_TITLES = [
      'Research Tool Applications',
      'Clinical Development Pipeline',
      'Clinical Validation Status',
      'Device Development Pipeline',
      'Clinical & Translational Activity',
    ]
    const s = CLINICAL_SECTION_TITLES.map((t) => sections.get(t)).find(Boolean)
    if (!s) {
      failures.push({ section: 'Clinical section', reason: 'no persona-appropriate clinical section rendered (any of: ' + CLINICAL_SECTION_TITLES.join(', ') + ')' })
    } else {
      const hasEmptyStateNotice = /No NIH-linked clinical trials were found/i.test(s)
      if (agentOutputs.trials.items.length === 0) {
        // Empty-state notice must be present.
        if (!hasEmptyStateNotice) {
          failures.push({ section: 'Clinical section', reason: '0 trials in data but section does not carry the required empty-state notice ("No NIH-linked clinical trials were found")' })
        }
      } else if (bodyCharCount(s) < 400) {
        failures.push({ section: 'Clinical section', reason: `body only ${bodyCharCount(s)} chars (need >=400) with ${agentOutputs.trials.items.length} trials in data` })
      }
    }
  }

  // ------------------------------------------------------------------
  // Patent Activity — only required if patents exist.
  // ------------------------------------------------------------------
  if (agentOutputs.patents.items.length > 0) {
    const s = sections.get('Patent Activity')
    if (!s) failures.push({ section: 'Patent Activity', reason: `section is missing but ${agentOutputs.patents.items.length} patents exist in the data` })
    else if (bodyCharCount(s) < 400) failures.push({ section: 'Patent Activity', reason: `body only ${bodyCharCount(s)} chars (need >=400)` })
  }

  // ------------------------------------------------------------------
  // White Space Analysis — required section with coverage tables.
  // ------------------------------------------------------------------
  {
    const s = sections.get('White Space Analysis')
    if (!s) failures.push({ section: 'White Space Analysis', reason: 'section is missing entirely' })
    else if (bodyCharCount(s) < 500) failures.push({ section: 'White Space Analysis', reason: `body only ${bodyCharCount(s)} chars (need >=500)` })
  }

  // ------------------------------------------------------------------
  // Next Steps — persona-specific checklist. Must have at least 3 items.
  // ------------------------------------------------------------------
  {
    const s = sections.get('Next Steps')
    if (!s) failures.push({ section: 'Next Steps', reason: 'section is missing entirely' })
    else {
      const checklistItems = (s.match(/^- \[ \]/gm) || []).length
      if (checklistItems < 3) failures.push({ section: 'Next Steps', reason: `only ${checklistItems} checklist items rendered (need >=3)` })
    }
  }

  // ------------------------------------------------------------------
  // Key Organizations / Researchers — always renderable from raw data;
  // if missing entirely something else is broken.
  // ------------------------------------------------------------------
  if (fundingStats.orgCount > 0 && !sections.has('Key Organizations')) {
    failures.push({ section: 'Key Organizations', reason: `section missing but ${fundingStats.orgCount} orgs in data` })
  }
  if (fundingStats.piCount > 0 && !sections.has('Key Researchers')) {
    failures.push({ section: 'Key Researchers', reason: `section missing but ${fundingStats.piCount} PIs in data` })
  }

  return failures
}

/**
 * Throws a formatted error if any completeness checks failed. Used
 * inside synthesizeReport to prevent thin reports from being persisted.
 */
export function assertReportComplete(input: CompletenessInput): void {
  const failures = validateReportCompleteness(input)
  if (failures.length === 0) return
  const summary = failures
    .map((f, i) => `  ${i + 1}. [${f.section}] ${f.reason}`)
    .join('\n')
  throw new Error(
    `Report completeness gate failed with ${failures.length} thin/missing section(s):\n${summary}\n\n` +
    `Refusing to persist a report with truncated content. The Inngest wrapper will retry the whole synthesis.`,
  )
}
