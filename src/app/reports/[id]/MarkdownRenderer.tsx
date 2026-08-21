'use client'

import Link from 'next/link'
import { FundingByYearChart, CategoryDistributionChart, TrialsByPhaseChart, WhiteSpaceCoverageChart } from './charts'

interface FundingByYearItem {
  year: number
  funding: number
  projects: number
}

interface CategoryItem {
  category: string
  funding: number
  projects: number
}

interface WhiteSpaceCategory {
  name: string
  keywords: string[]
  projectCount: number
  fundingTotal: number
  broaderNihCount: number
  projectExamples: string[]
}

interface WhiteSpaceDimension {
  name: string
  description: string
  categories: WhiteSpaceCategory[]
  totalMatched: number
  totalUnclassified: number
  narrative: string
}

interface WhiteSpaceData {
  overview: string
  scopeNote: string
  dimensions: WhiteSpaceDimension[]
  topOpportunities: unknown[]
  totalProjects: number
  totalFunding: number
}

interface ChartData {
  fundingByYear?: FundingByYearItem[]
  categories?: CategoryItem[]
  trialsByPhase?: Record<string, number>
  whiteSpace?: WhiteSpaceData
}

interface MarkdownRendererProps {
  content: string
  chartData?: ChartData
  /**
   * When set, chart components render with fixed pixel dimensions
   * instead of ResponsiveContainer. Used by the print route (Puppeteer
   * PDF rendering) because ResponsiveContainer's ResizeObserver +
   * CSS-force chain is unreliable in headless Chromium.
   */
  printChartWidth?: number
  printChartHeight?: number
  /**
   * When true, the wrapper div drops the default `p-8` padding. Use
   * this when embedding the renderer inside a component that already
   * provides its own padding (e.g. finding cards on the What Surprised
   * Us page). Without this the p-8 stacks with the parent padding and
   * produces a visible content indent.
   */
  compact?: boolean
}

export function MarkdownRenderer({ content, chartData, printChartWidth, printChartHeight, compact }: MarkdownRendererProps) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip empty lines
    if (!line.trim()) {
      i++
      continue
    }

    // Chart marker (e.g. <!-- chart:funding-by-year -->)
    // White space charts use an indexed form: <!-- chart:white-space-dimension:0 -->
    const chartMatch = line.trim().match(/^<!--\s*chart:([\w-]+)(?::(\d+))?\s*-->$/)
    if (chartMatch) {
      const name = chartMatch[1]
      const index = chartMatch[2] ? parseInt(chartMatch[2], 10) : undefined
      if (name === 'funding-by-year' && chartData?.fundingByYear?.length) {
        elements.push(
          <div key={i} className="my-4">
            <FundingByYearChart
              data={chartData.fundingByYear}
              fixedWidth={printChartWidth}
              fixedHeight={printChartHeight}
            />
          </div>
        )
      } else if (name === 'categories' && chartData?.categories?.length) {
        elements.push(
          <div key={i} className="my-4">
            <CategoryDistributionChart
              data={chartData.categories}
              fixedWidth={printChartWidth}
              fixedHeight={printChartHeight}
            />
          </div>
        )
      } else if (name === 'trials-by-phase' && chartData?.trialsByPhase) {
        elements.push(
          <div key={i} className="my-4">
            <TrialsByPhaseChart
              data={chartData.trialsByPhase}
              fixedWidth={printChartWidth}
              fixedHeight={printChartHeight}
            />
          </div>
        )
      } else if (
        name === 'white-space-dimension' &&
        typeof index === 'number' &&
        chartData?.whiteSpace?.dimensions?.[index]
      ) {
        const dim = chartData.whiteSpace.dimensions[index]
        elements.push(
          <div key={i} className="my-4">
            <WhiteSpaceCoverageChart
              dimensionName={dim.name}
              categories={dim.categories}
              totalProjects={chartData.whiteSpace.totalProjects}
              totalUnclassified={dim.totalUnclassified}
              fixedWidth={printChartWidth}
            />
          </div>
        )
      }
      i++
      continue
    }

    // Headers
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-gray-900 mb-4 mt-8 first:mt-0 tracking-tight">
          {processInline(line.slice(2))}
        </h1>
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      // Dropped the border-t / pt-4 that made every H2 feel like a
      // document divider. Modern editorial typography relies on
      // whitespace + weight for hierarchy, not lines.
      elements.push(
        <h2 key={i} className="text-xl font-semibold text-gray-900 mb-3 mt-10 first:mt-0 tracking-tight">
          {processInline(line.slice(3))}
        </h2>
      )
      i++
      continue
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-base font-semibold text-gray-900 mb-2 mt-7 first:mt-0">
          {processInline(line.slice(4))}
        </h3>
      )
      i++
      continue
    }
    if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-sm font-semibold text-gray-900 mb-2 mt-5 first:mt-0 uppercase tracking-wider text-gray-500">
          {processInline(line.slice(5))}
        </h4>
      )
      i++
      continue
    }

    // Horizontal rule — softer than the old default so it reads as
    // section rhythm, not as a hard divider.
    if (line.match(/^---+$/)) {
      elements.push(
        <hr key={i} className="my-8 border-gray-100" />
      )
      i++
      continue
    }

    // Blockquote — subtle tinted panel instead of the old brand-orange
    // side-strip which competed with the section header color.
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <blockquote key={i} className="my-5 px-4 py-3 bg-gray-50 border-l-2 border-gray-300 rounded-r text-[15px] text-gray-600 leading-relaxed">
          {quoteLines.map((ql, qi) => (
            <p key={qi} className="my-0">{processInline(ql)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    // Table
    if (line.includes('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(renderTable(tableLines, elements.length))
      continue
    }

    // Unordered list — pl-5 (outside) + tighter marker spacing reads
    // more like editorial body than a form checklist. Marker color
    // matches brand orange so lists feel intentional.
    if (line.match(/^[-*] /)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        listItems.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <ul key={i} className="list-disc pl-5 space-y-2 my-4 text-[15px] text-gray-700 leading-relaxed marker:text-[#E07A5F]">
          {listItems.map((item, li) => (
            <li key={li}>{processInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Confidence tag interception. Every Analysis-section prose passage
    // may contain an inline `**Confidence: X**` marker, sometimes with
    // ` - Evidence: ...` on the same line, sometimes with `*Evidence:
    // ...*` on the following line. Left inline, the tag renders as
    // literal bold text mid-paragraph — visually flat, no color signal.
    // Extract them here and render as a colored chip + tinted evidence
    // panel (same treatment as the What Surprised Us page's structured
    // renderer). Applies globally so every section — Field Maturity,
    // Competitive Topology, White Space, IP Landscape, etc. — inherits
    // the treatment.
    const confMatch = line.match(
      /\*\*Confidence:\s*(High|Medium|Low)\*\*(?:\s*[-–—]\s*Evidence:\s*([^\n]+?))?\s*\.?$/i,
    )
    if (confMatch) {
      const level = confMatch[1] as 'High' | 'Medium' | 'Low'
      let evidence = confMatch[2] ? confMatch[2].trim() : ''
      const prefix = line.slice(0, confMatch.index).trim().replace(/[-–—]\s*$/, '').trim()

      // Look ahead one line for a separate `*Evidence: ...*` italic
      // when the tag didn't include inline evidence.
      if (!evidence && i + 1 < lines.length) {
        const evMatch = lines[i + 1].trim().match(/^\*Evidence:\s*(.+?)\*\.?$/i)
        if (evMatch) {
          evidence = evMatch[1].trim()
          i++
        }
      }

      if (prefix) {
        elements.push(
          <p key={`${i}-prefix`} className="text-[15px] text-gray-700 leading-7 mb-3">
            {processInline(prefix)}
          </p>
        )
      }
      elements.push(<ConfidenceChip key={`${i}-chip`} level={level} />)
      if (evidence) {
        elements.push(<EvidencePanel key={`${i}-evid`} text={evidence} />)
      }
      i++
      continue
    }

    // Standalone italic evidence line (no preceding confidence tag on
    // same line — rare but happens with some persona variants).
    const italicEvidenceMatch = line.trim().match(/^\*Evidence:\s*(.+?)\*\.?$/i)
    if (italicEvidenceMatch) {
      elements.push(<EvidencePanel key={i} text={italicEvidenceMatch[1].trim()} />)
      i++
      continue
    }

    // Paragraph — slightly larger + more generous line-height than the
    // old default for better readability of long analytical prose.
    elements.push(
      <p key={i} className="text-[15px] text-gray-700 leading-7 mb-4">
        {processInline(line)}
      </p>
    )
    i++
  }

  return (
    <div className={compact ? 'prose-sm' : 'p-8 prose-sm'}>
      {elements}
    </div>
  )
}

export function processInline(text: string): React.ReactNode {
  // Process inline elements: bold, italic, links, code
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      parts.push(
        <strong key={key++} className="font-semibold text-gray-900">
          {boldMatch[1]}
        </strong>
      )
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Link: [text](url)
    //
    // URL allowlist: same-origin paths (start with `/` but not `//`)
    // render as in-app Link, http(s):// open in new tab. Anything else
    // — `javascript:`, `data:`, `vbscript:`, file:, etc. — is rendered
    // as plain text. The synthesis Claude prompt is constrained to
    // produce only same-origin and http(s) URLs, but report markdown
    // is user-influenced (topic text, NIH abstracts, etc.) and a
    // prompt-injection that emitted `[click me](javascript:alert(1))`
    // would otherwise execute on click.
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const [, linkText, url] = linkMatch
      const trimmedUrl = url.trim()
      const isSameOrigin =
        trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')
      const isHttp =
        trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')

      if (isSameOrigin) {
        parts.push(
          <Link key={key++} href={trimmedUrl} className="text-[#E07A5F] hover:text-[#C96A4F] underline">
            {linkText}
          </Link>
        )
      } else if (isHttp) {
        parts.push(
          <a
            key={key++}
            href={trimmedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E07A5F] hover:text-[#C96A4F] underline"
          >
            {linkText}
          </a>
        )
      } else {
        // Disallowed scheme — render the visible text only, no link.
        parts.push(<span key={key++}>{linkText}</span>)
      }
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-gray-100 rounded text-sm font-mono text-gray-800">
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Italic: *text* (but not ** which is bold)
    const italicMatch = remaining.match(/^\*([^*]+)\*/)
    if (italicMatch && !remaining.startsWith('**')) {
      parts.push(
        <em key={key++} className="italic">
          {italicMatch[1]}
        </em>
      )
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Regular character
    // Find the next special character or end of string
    const nextSpecial = remaining.slice(1).search(/\*|\[|`/)
    const endIndex = nextSpecial === -1 ? remaining.length : nextSpecial + 1
    parts.push(remaining.slice(0, endIndex))
    remaining = remaining.slice(endIndex)
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>
}

function renderTable(lines: string[], key: number): React.ReactNode {
  // Parse table
  const rows = lines
    .filter((line) => !line.match(/^\|[-:| ]+\|$/)) // Skip separator row
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
    )

  if (rows.length === 0) return null

  const headers = rows[0]
  const body = rows.slice(1)

  // Editorial table treatment — hairline top/bottom borders, subtle
  // row separators, more padding, uppercase-caps header labels.
  // Reads as a data element rather than a form grid.
  return (
    <div
      key={key}
      className="my-6 overflow-x-auto rounded-lg border border-gray-200 bg-white"
    >
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60">
            {headers.map((header, i) => (
              <th
                key={i}
                className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider"
              >
                {processInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors"
            >
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-3 text-[14px] text-gray-700 align-top">
                  {processInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// -------------------------------------------------------------------
// Confidence + Evidence primitives — shared by inline extraction in the
// paragraph handler AND by structured-render callers (e.g. Surprising).
// Kept alongside MarkdownRenderer so every rendering of a report body
// gets the same treatment.
// -------------------------------------------------------------------

export interface ConfidenceChipProps {
  level: 'High' | 'Medium' | 'Low'
}

const CONFIDENCE_CHIP_STYLES: Record<ConfidenceChipProps['level'], { chip: string; dot: string; label: string }> = {
  High:   { chip: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', label: 'High confidence' },
  Medium: { chip: 'bg-amber-50 text-amber-800',     dot: 'bg-amber-500',   label: 'Medium confidence' },
  Low:    { chip: 'bg-rose-50 text-rose-800',       dot: 'bg-rose-500',    label: 'Low confidence' },
}

export function ConfidenceChip({ level }: ConfidenceChipProps) {
  const s = CONFIDENCE_CHIP_STYLES[level]
  return (
    <div className="mt-4 mb-1">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${s.chip}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
    </div>
  )
}

export interface EvidencePanelProps {
  text: string
}

export function EvidencePanel({ text }: EvidencePanelProps) {
  return (
    <div className="mt-2 mb-4 bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
      <p className="text-xs text-gray-600 leading-relaxed my-0">
        <span className="font-semibold text-gray-700 uppercase tracking-wider text-[10px] mr-1.5">
          Evidence
        </span>
        {text}
      </p>
    </div>
  )
}
