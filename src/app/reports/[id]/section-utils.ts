// Helpers for slicing the assembled report markdown into portal-page
// content. Every report is generated as one long markdown document
// with `## ` section headings; the portal shows different subsets of
// those sections on different pages (dashboard = narrative; section
// pages = one or two heavy sections each).
//
// This is temporary infrastructure. Long-term the synthesis step should
// emit each section as its own field so we don't parse markdown at
// render time. For now, slicing works and keeps the pivot to a
// contained render-layer change.

export interface MarkdownSection {
  heading: string
  /** Full section text including the `## heading` line. */
  body: string
}

/**
 * Split a markdown document into `## ` sections. The pre-heading
 * preamble (title + `**Generated:**` line, `---`, etc.) is discarded —
 * the portal renders its own header, so the intrinsic markdown header
 * is redundant.
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  if (!markdown) return []
  const lines = markdown.split('\n')
  const sections: MarkdownSection[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/)
    if (match) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentLines.join('\n') })
      }
      currentHeading = match[1].trim()
      currentLines = [line]
    } else if (currentHeading !== null) {
      currentLines.push(line)
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentLines.join('\n') })
  }
  return sections
}

/**
 * Return the concatenated markdown of the given sections, in the order
 * requested. Case-insensitive match; missing sections are skipped
 * silently (so a persona variant with no "What Surprised Us" section
 * just renders one fewer block instead of erroring).
 *
 * Separator between kept sections is a horizontal rule so the render
 * matches the linear-report visual rhythm.
 */
export function pickSections(markdown: string, headings: string[]): string {
  const sections = splitMarkdownSections(markdown)
  const wanted = headings.map((h) => h.toLowerCase())
  const kept: string[] = []
  for (const h of wanted) {
    const s = sections.find((x) => x.heading.toLowerCase() === h)
    if (s) kept.push(s.body)
  }
  return kept.join('\n\n---\n\n')
}

/**
 * Extract the SCOPE WARNING blockquote that renderScopeWarningBanner
 * injects at the top of the report (before the first `## ` section).
 * Rendered separately in the portal header so it's the first thing a
 * reader sees regardless of which section page they land on.
 * Returns empty string when the report has no scope warning (the
 * common case for on-topic reports).
 */
export function extractScopeWarning(markdown: string): string {
  if (!markdown) return ''
  const firstH2Idx = markdown.search(/^##\s+/m)
  const preamble = firstH2Idx >= 0 ? markdown.slice(0, firstH2Idx) : markdown
  const match = preamble.match(/>\s*\*\*SCOPE WARNING[\s\S]*?(?=\n\n---|\n---|\n##|\n$)/)
  return match ? match[0].trim() : ''
}

/**
 * Dashboard section list — the narrative subset a first-time visitor
 * sees on `/reports/[id]`. Reading material only; reference material
 * (project cards, publication lists, patent tables) lives on dedicated
 * section pages the visitor can navigate to via the sidebar.
 */
export const DASHBOARD_SECTIONS: string[] = [
  'Executive Summary',
  'What Surprised Us',
  'Field Maturity Assessment',
  'Competitive Topology',
  'Next Steps',
]
