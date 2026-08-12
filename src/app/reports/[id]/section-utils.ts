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
 * Sections rendered on the dashboard's narrative area (below the
 * metric tiles and the Surprising Findings teaser). Includes both
 * the exec-summary tl;dr paragraphs and the Next Steps checklist —
 * the classic "situational awareness + recommended action" pair.
 * Discrete analytical outputs (Field Maturity, Competitive Topology,
 * White Space, Market Context, Funding Landscape, full What Surprised
 * Us) live on their own Analysis pages so each is shareable via URL.
 */
export const DASHBOARD_SECTIONS: string[] = [
  'Executive Summary',
  'Next Steps',
]

/**
 * Extract the first N "surprising findings" headlines from a
 * `What Surprised Us` section so the dashboard can show a teaser
 * card linking to the full page. Returns [] when the section is
 * absent (persona variant that omitted it, or a report where the
 * detector found nothing).
 *
 * The markdown format emitted by renderSurprisingFindings in
 * synthesize.ts is:
 *   **1. [headline]**
 *   [interpretation]
 *   **Confidence: X** - Evidence: [...]
 * so we scan for lines matching the numbered-headline pattern.
 */
export interface SurprisingHeadline {
  index: number
  headline: string
}

export function extractSurprisingHeadlines(
  markdown: string,
  max: number = 3,
): SurprisingHeadline[] {
  if (!markdown) return []
  const section = splitMarkdownSections(markdown).find(
    (s) => s.heading.toLowerCase() === 'what surprised us',
  )
  if (!section) return []
  const headlines: SurprisingHeadline[] = []
  // Match `**N. headline**` at start of line. Non-greedy to stop at
  // the closing bold. The `*` inside a claim's inline emphasis won't
  // match because we anchor on the "N. " prefix.
  const re = /^\*\*(\d+)\.\s+([^*]+?)\*\*\s*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(section.body)) !== null) {
    headlines.push({ index: Number(m[1]), headline: m[2].trim() })
    if (headlines.length >= max) break
  }
  return headlines
}
