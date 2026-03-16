'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { FileText, ArrowLeft, AlertCircle, FileDown, Loader2, FileType } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { jsPDF } from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx'
import { saveAs } from 'file-saver'

interface FundingByYear {
  year: number
  funding: number
  projects: number
}

interface CategoryData {
  category: string
  projects: number
  funding: number
}

interface FundingStats {
  total: number
  projectCount: number
  orgCount: number
  piCount: number
  byYear: FundingByYear[]
  byCategory: CategoryData[]
  byOrg: Array<{ org: string; projects: number; funding: number }>
}

interface TrialsAgentOutput {
  items: unknown[]
  byPhase: Record<string, number>
  byStatus: Record<string, number>
}

interface AgentOutputs {
  projects: unknown
  trials: TrialsAgentOutput
  patents: unknown
  publications: unknown
  market: unknown
}

interface Report {
  id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  status: 'generating' | 'complete' | 'failed'
  markdown_content: string | null
  executive_summary: string | null
  project_count: number | null
  data_limited: boolean
  error_message: string | null
  created_at: string
  updated_at: string
  // Chart data
  funding_stats: FundingStats | null
  agent_outputs: AgentOutputs | null
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport()
  }, [id])

  // Poll while generating
  useEffect(() => {
    if (!report || report.status !== 'generating') return

    const interval = setInterval(fetchReport, 5000)
    return () => clearInterval(interval)
  }, [report?.status])

  const fetchReport = async () => {
    try {
      const response = await fetch(`/api/reports/${id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch report')
      }

      setReport(data.report)
    } catch (e) {
      console.error('Error fetching report:', e)
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)

  const downloadPdf = async () => {
    if (!report?.markdown_content) return

    setExporting('pdf')

    try {
      const filename = `${report.title.replace(/[^a-z0-9]/gi, '_')}.pdf`
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'letter'
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 54 // 0.75 inch
      const maxWidth = pageWidth - margin * 2
      let y = margin
      let isFirstElement = true

      const cleanText = (text: string): string => {
        let result = text
          // Remove markdown formatting
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          // Replace smart quotes and dashes
          .replace(/[""]/g, '"')
          .replace(/['']/g, "'")
          .replace(/[–—]/g, '-')
          .replace(/[…]/g, '...')
          // Replace mathematical and scientific symbols
          .replace(/[±]/g, '+/-')
          .replace(/[×]/g, 'x')
          .replace(/[÷]/g, '/')
          .replace(/[≤]/g, '<=')
          .replace(/[≥]/g, '>=')
          .replace(/[≈]/g, '~')
          .replace(/[≠]/g, '!=')
          .replace(/[°]/g, ' deg')
          .replace(/[µμ]/g, 'u')
          // Replace Greek letters with names
          .replace(/[αΑ]/g, 'alpha')
          .replace(/[βΒ]/g, 'beta')
          .replace(/[γΓ]/g, 'gamma')
          .replace(/[δΔ]/g, 'delta')
          .replace(/[εΕ]/g, 'epsilon')
          .replace(/[ζΖ]/g, 'zeta')
          .replace(/[ηΗ]/g, 'eta')
          .replace(/[θΘ]/g, 'theta')
          .replace(/[ιΙ]/g, 'iota')
          .replace(/[κΚ]/g, 'kappa')
          .replace(/[λΛ]/g, 'lambda')
          .replace(/[νΝ]/g, 'nu')
          .replace(/[ξΞ]/g, 'xi')
          .replace(/[οΟ]/g, 'omicron')
          .replace(/[πΠ]/g, 'pi')
          .replace(/[ρΡ]/g, 'rho')
          .replace(/[σΣς]/g, 'sigma')
          .replace(/[τΤ]/g, 'tau')
          .replace(/[υΥ]/g, 'upsilon')
          .replace(/[φΦ]/g, 'phi')
          .replace(/[χΧ]/g, 'chi')
          .replace(/[ψΨ]/g, 'psi')
          .replace(/[ωΩ]/g, 'omega')
          // Replace superscripts and subscripts
          .replace(/[⁰]/g, '0')
          .replace(/[¹]/g, '1')
          .replace(/[²]/g, '2')
          .replace(/[³]/g, '3')
          .replace(/[⁴]/g, '4')
          .replace(/[⁵]/g, '5')
          .replace(/[⁶]/g, '6')
          .replace(/[⁷]/g, '7')
          .replace(/[⁸]/g, '8')
          .replace(/[⁹]/g, '9')
          .replace(/[₀]/g, '0')
          .replace(/[₁]/g, '1')
          .replace(/[₂]/g, '2')
          .replace(/[₃]/g, '3')
          .replace(/[₄]/g, '4')
          .replace(/[₅]/g, '5')
          .replace(/[₆]/g, '6')
          .replace(/[₇]/g, '7')
          .replace(/[₈]/g, '8')
          .replace(/[₉]/g, '9')

        // Strip any remaining non-ASCII characters that could cause rendering issues
        // Keep only printable ASCII (32-126) plus newlines and tabs
        result = result.replace(/[^\x20-\x7E\n\t]/g, '')

        return result
      }

      const addNewPageIfNeeded = (height: number) => {
        if (y + height > pageHeight - margin) {
          doc.addPage()
          y = margin
          return true
        }
        return false
      }

      // Collect table rows for proper rendering
      const lines = report.markdown_content.split('\n')
      let i = 0

      while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        if (!trimmed) {
          y += 6
          i++
          continue
        }

        // Skip table separator rows
        if (trimmed.match(/^\|[-:| ]+\|$/)) {
          i++
          continue
        }

        // H1 Header
        if (trimmed.startsWith('# ')) {
          if (!isFirstElement) y += 16
          addNewPageIfNeeded(24)
          doc.setFontSize(16)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 20 + 8
          isFirstElement = false
          i++
          continue
        }

        // H2 Header
        if (trimmed.startsWith('## ')) {
          y += 16
          addNewPageIfNeeded(24)
          doc.setFontSize(13)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(3))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 16 + 6
          isFirstElement = false
          i++
          continue
        }

        // H3 Header
        if (trimmed.startsWith('### ')) {
          y += 8
          addNewPageIfNeeded(18)
          doc.setFontSize(11)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(4))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 14 + 6
          isFirstElement = false
          i++
          continue
        }

        // H4 Header
        if (trimmed.startsWith('#### ')) {
          y += 6
          addNewPageIfNeeded(16)
          doc.setFontSize(10)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(5))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 13 + 4
          isFirstElement = false
          i++
          continue
        }

        // Horizontal rule
        if (trimmed.match(/^---+$/)) {
          y += 8
          doc.setDrawColor(229, 231, 235)
          doc.setLineWidth(0.5)
          doc.line(margin, y, pageWidth - margin, y)
          y += 12
          i++
          continue
        }

        // Blockquote
        if (trimmed.startsWith('> ')) {
          addNewPageIfNeeded(18)
          doc.setFontSize(9)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(107, 114, 128)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth - 14)
          const blockHeight = splitText.length * 11 + 2
          doc.setDrawColor(224, 122, 95)
          doc.setLineWidth(2)
          doc.line(margin, y - 2, margin, y + blockHeight - 2)
          doc.text(splitText, margin + 8, y)
          y += blockHeight + 6
          doc.setTextColor(0, 0, 0)
          doc.setLineWidth(0.5)
          isFirstElement = false
          i++
          continue
        }

        // Table - collect all rows first
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          const tableData: string[][] = []
          while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
            const row = lines[i].trim()
            if (!row.match(/^\|[-:| ]+\|$/)) {
              const cells = row.split('|').slice(1, -1).map(c => cleanText(c.trim()))
              tableData.push(cells)
            }
            i++
          }

          if (tableData.length > 0) {
            const colCount = tableData[0].length
            const colWidth = maxWidth / colCount
            const rowHeight = 14

            addNewPageIfNeeded(tableData.length * rowHeight + 8)

            // Draw table
            tableData.forEach((row, rowIndex) => {
              const rowY = y + rowIndex * rowHeight

              // Header row background
              if (rowIndex === 0) {
                doc.setFillColor(249, 250, 251)
                doc.rect(margin, rowY - 10, maxWidth, rowHeight, 'F')
              }

              // Row border
              doc.setDrawColor(229, 231, 235)
              doc.setLineWidth(0.5)
              doc.line(margin, rowY + 4, margin + maxWidth, rowY + 4)

              // Cell text
              doc.setFontSize(9)
              doc.setFont('helvetica', rowIndex === 0 ? 'bold' : 'normal')
              doc.setTextColor(rowIndex === 0 ? 17 : 55, rowIndex === 0 ? 24 : 65, rowIndex === 0 ? 39 : 81)

              row.forEach((cell, colIndex) => {
                const cellX = margin + colIndex * colWidth + 4
                const cellText = doc.splitTextToSize(cell, colWidth - 8)
                doc.text(cellText[0] || '', cellX, rowY)
              })
            })

            y += tableData.length * rowHeight + 8
          }
          isFirstElement = false
          continue
        }

        // List item
        if (trimmed.match(/^[-*] /)) {
          addNewPageIfNeeded(14)
          doc.setFontSize(9.5)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(55, 65, 81)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth - 12)
          doc.text('•', margin, y)
          doc.text(splitText, margin + 12, y)
          y += splitText.length * 12 + 3
          isFirstElement = false
          i++
          continue
        }

        // Regular paragraph
        addNewPageIfNeeded(14)
        doc.setFontSize(9.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(55, 65, 81)
        const text = cleanText(trimmed)
        const splitText = doc.splitTextToSize(text, maxWidth)
        doc.text(splitText, margin, y)
        y += splitText.length * 12 + 4
        isFirstElement = false
        i++
      }

      doc.save(filename)
    } catch (e) {
      console.error('Error generating PDF:', e)
      alert('Failed to generate PDF. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  const downloadWord = async () => {
    if (!report?.markdown_content) return

    setExporting('docx')

    try {
      const filename = `${report.title.replace(/[^a-z0-9]/gi, '_')}.docx`
      const children: (Paragraph | Table)[] = []

      // Parse markdown content into Word document elements
      const lines = report.markdown_content.split('\n')
      let inTable = false
      let tableRows: string[][] = []
      let inBlockquote = false
      let blockquoteLines: string[] = []

      const flushBlockquote = () => {
        if (blockquoteLines.length > 0) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: blockquoteLines.join(' '),
                  italics: true,
                  color: '555555',
                }),
              ],
              indent: { left: 720 },
              border: {
                left: {
                  color: 'E07A5F',
                  size: 24,
                  style: BorderStyle.SINGLE,
                  space: 10,
                },
              },
              spacing: { before: 120, after: 120 },
            })
          )
          blockquoteLines = []
        }
        inBlockquote = false
      }

      const flushTable = () => {
        if (tableRows.length > 0) {
          const table = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows.map((row, rowIndex) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: cell.trim(),
                              bold: rowIndex === 0,
                            }),
                          ],
                        }),
                      ],
                      shading: rowIndex === 0 ? { fill: 'F5F5F5' } : undefined,
                    })
                ),
              })
            ),
          })
          children.push(table)
          children.push(new Paragraph({ text: '' })) // spacing after table
          tableRows = []
        }
        inTable = false
      }

      for (const line of lines) {
        const trimmed = line.trim()

        // Handle tables
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          flushBlockquote()
          // Skip separator rows (|---|---|)
          if (trimmed.match(/^\|[\s\-:|]+\|$/)) {
            continue
          }
          inTable = true
          const cells = trimmed
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
          tableRows.push(cells)
          continue
        } else if (inTable) {
          flushTable()
        }

        // Handle blockquotes
        if (trimmed.startsWith('>')) {
          inBlockquote = true
          blockquoteLines.push(trimmed.slice(1).trim())
          continue
        } else if (inBlockquote) {
          flushBlockquote()
        }

        // Handle headings
        if (trimmed.startsWith('# ')) {
          children.push(
            new Paragraph({
              text: trimmed.slice(2),
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 400, after: 200 },
            })
          )
        } else if (trimmed.startsWith('## ')) {
          children.push(
            new Paragraph({
              text: trimmed.slice(3),
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 300, after: 150 },
            })
          )
        } else if (trimmed.startsWith('### ')) {
          children.push(
            new Paragraph({
              text: trimmed.slice(4),
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 200, after: 100 },
            })
          )
        } else if (trimmed.startsWith('#### ')) {
          children.push(
            new Paragraph({
              text: trimmed.slice(5),
              heading: HeadingLevel.HEADING_4,
              spacing: { before: 150, after: 80 },
            })
          )
        } else if (trimmed.startsWith('---')) {
          // Horizontal rule - add some spacing
          children.push(
            new Paragraph({
              text: '',
              border: {
                bottom: {
                  color: 'DDDDDD',
                  size: 6,
                  style: BorderStyle.SINGLE,
                  space: 10,
                },
              },
              spacing: { before: 200, after: 200 },
            })
          )
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          // Bullet points
          const bulletText = trimmed.slice(2)
          // Handle bold text within bullets
          const parts = bulletText.split(/\*\*([^*]+)\*\*/)
          const runs: TextRun[] = []
          parts.forEach((part, index) => {
            if (index % 2 === 1) {
              runs.push(new TextRun({ text: part, bold: true }))
            } else if (part) {
              runs.push(new TextRun({ text: part }))
            }
          })
          children.push(
            new Paragraph({
              children: runs,
              bullet: { level: 0 },
              spacing: { before: 60, after: 60 },
            })
          )
        } else if (trimmed === '') {
          // Empty line
          children.push(new Paragraph({ text: '' }))
        } else {
          // Regular paragraph - handle bold and links
          const parts = trimmed.split(/\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]+\)/)
          const runs: TextRun[] = []
          let plainIndex = 0

          // Simple approach: just handle bold for now
          const boldParts = trimmed.split(/\*\*([^*]+)\*\*/)
          boldParts.forEach((part, index) => {
            if (index % 2 === 1) {
              runs.push(new TextRun({ text: part, bold: true }))
            } else if (part) {
              // Remove markdown links but keep text
              const cleanText = part.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              runs.push(new TextRun({ text: cleanText }))
            }
          })

          if (runs.length > 0) {
            children.push(
              new Paragraph({
                children: runs,
                spacing: { before: 60, after: 60 },
              })
            )
          }
        }
      }

      // Flush any remaining content
      flushBlockquote()
      flushTable()

      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: 1440, // 1 inch in twips
                  right: 1440,
                  bottom: 1440,
                  left: 1440,
                },
              },
            },
            children,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      saveAs(blob, filename)
    } catch (e) {
      console.error('Error generating Word document:', e)
      alert('Failed to generate Word document. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
            <div className="flex items-center justify-between">
              <Link href="/" className="text-xl font-semibold text-gray-900">
                granted<span className="text-[#E07A5F]">.bio</span>
              </Link>
              <Link
                href="/reports"
                className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
              >
                ← Back to Reports
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {error || 'Report not found'}
            </h2>
            <Link
              href="/reports"
              className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Go back to reports
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <Link
              href="/reports"
              className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Reports
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {/* Report Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-[#FDF2EF] rounded-lg">
                <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 mb-1">
                  {report.title}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Generated {formatDate(report.created_at)}</span>
                  {report.project_count !== null && (
                    <>
                      <span>•</span>
                      <span>{report.project_count} projects analyzed</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {report.status === 'complete' && report.markdown_content && (
              <div className="flex items-center gap-3 text-xs">
                <button
                  onClick={downloadPdf}
                  disabled={exporting !== null}
                  className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors disabled:opacity-50"
                >
                  {exporting === 'pdf' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                  )}
                  {exporting === 'pdf' ? 'Generating...' : 'PDF'}
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={downloadWord}
                  disabled={exporting !== null}
                  className="flex items-center gap-1.5 text-gray-500 hover:text-[#E07A5F] transition-colors disabled:opacity-50"
                >
                  {exporting === 'docx' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileType className="w-3.5 h-3.5" strokeWidth={1.5} />
                  )}
                  {exporting === 'docx' ? 'Generating...' : 'Word'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Report Content */}
        {report.status === 'generating' && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="relative inline-block mb-4">
              <FileText className="w-16 h-16 text-[#E07A5F]" strokeWidth={1.5} />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow">
                <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
              </div>
            </div>
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Generating Report...
            </h2>
            <p className="text-gray-500">
              Our AI agents are gathering and analyzing data. This page will
              automatically update when the report is ready.
            </p>
          </div>
        )}

        {report.status === 'failed' && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Report Generation Failed
            </h2>
            <p className="text-gray-500 mb-2">
              {report.error_message || 'An error occurred while generating the report.'}
            </p>
            <Link
              href="/reports"
              className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Go back to reports
            </Link>
          </div>
        )}

        {report.status === 'complete' && report.markdown_content && (
          <div id="report-content" className="bg-white rounded-lg shadow-sm">
            <MarkdownRenderer content={report.markdown_content} />
          </div>
        )}
      </main>
    </div>
  )
}
