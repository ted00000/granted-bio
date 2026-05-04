'use client'

import Link from 'next/link'
import { FundingByYearChart, CategoryDistributionChart, TrialsByPhaseChart } from './charts'

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

interface ChartData {
  fundingByYear?: FundingByYearItem[]
  categories?: CategoryItem[]
  trialsByPhase?: Record<string, number>
}

interface MarkdownRendererProps {
  content: string
  chartData?: ChartData
}

export function MarkdownRenderer({ content, chartData }: MarkdownRendererProps) {
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
    const chartMatch = line.trim().match(/^<!--\s*chart:([\w-]+)\s*-->$/)
    if (chartMatch) {
      const name = chartMatch[1]
      if (name === 'funding-by-year' && chartData?.fundingByYear?.length) {
        elements.push(
          <div key={i} className="my-4">
            <FundingByYearChart data={chartData.fundingByYear} />
          </div>
        )
      } else if (name === 'categories' && chartData?.categories?.length) {
        elements.push(
          <div key={i} className="my-4">
            <CategoryDistributionChart data={chartData.categories} />
          </div>
        )
      } else if (name === 'trials-by-phase' && chartData?.trialsByPhase) {
        elements.push(
          <div key={i} className="my-4">
            <TrialsByPhaseChart data={chartData.trialsByPhase} />
          </div>
        )
      }
      i++
      continue
    }

    // Headers
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-2xl font-bold text-gray-900 mb-4 mt-8 first:mt-0">
          {processInline(line.slice(2))}
        </h1>
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-xl font-semibold text-gray-900 mb-3 mt-8 pt-4 border-t border-gray-100">
          {processInline(line.slice(3))}
        </h2>
      )
      i++
      continue
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-lg font-semibold text-gray-900 mb-2 mt-6">
          {processInline(line.slice(4))}
        </h3>
      )
      i++
      continue
    }
    if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-base font-semibold text-gray-900 mb-2 mt-4">
          {processInline(line.slice(5))}
        </h4>
      )
      i++
      continue
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      elements.push(
        <hr key={i} className="my-6 border-gray-200" />
      )
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <blockquote key={i} className="border-l-4 border-[#E07A5F] pl-4 py-2 my-4 text-gray-600 italic bg-gray-50 rounded-r">
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{processInline(ql)}</p>
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

    // Unordered list
    if (line.match(/^[-*] /)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        listItems.push(lines[i].slice(2))
        i++
      }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-1 my-3 text-gray-700">
          {listItems.map((item, li) => (
            <li key={li}>{processInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Paragraph
    elements.push(
      <p key={i} className="text-gray-700 leading-relaxed mb-3">
        {processInline(line)}
      </p>
    )
    i++
  }

  return (
    <div className="p-8 prose-sm">
      {elements}
    </div>
  )
}

function processInline(text: string): React.ReactNode {
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
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const [, linkText, url] = linkMatch
      if (url.startsWith('/')) {
        parts.push(
          <Link key={key++} href={url} className="text-[#E07A5F] hover:text-[#C96A4F] underline">
            {linkText}
          </Link>
        )
      } else {
        parts.push(
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E07A5F] hover:text-[#C96A4F] underline"
          >
            {linkText}
          </a>
        )
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

  return (
    <div key={key} className="overflow-x-auto my-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {headers.map((header, i) => (
              <th
                key={i}
                className="px-4 py-2 text-left font-semibold text-gray-900"
              >
                {processInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="border-b border-gray-100 hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2 text-gray-700">
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
