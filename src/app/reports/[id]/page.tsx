'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { FileText, ArrowLeft, AlertCircle, FileDown, Loader2, FileType } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import html2pdf from 'html2pdf.js'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx'
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

  // Convert modern CSS color functions (lab, oklch, etc.) to hex for html2canvas compatibility
  const convertColorsToHex = (element: HTMLElement) => {
    const colorProps = ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor']

    const processElement = (el: HTMLElement) => {
      const computed = window.getComputedStyle(el)

      colorProps.forEach(prop => {
        const value = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase())
        if (value && (value.includes('lab(') || value.includes('oklch(') || value.includes('oklab('))) {
          // Create a temporary element to compute the color as rgb
          const temp = document.createElement('div')
          temp.style.color = value
          document.body.appendChild(temp)
          const rgbValue = window.getComputedStyle(temp).color
          document.body.removeChild(temp)

          // Apply the rgb value
          if (prop === 'color') el.style.color = rgbValue
          else if (prop === 'backgroundColor') el.style.backgroundColor = rgbValue
          else if (prop === 'borderColor') el.style.borderColor = rgbValue
          else if (prop === 'borderTopColor') el.style.borderTopColor = rgbValue
          else if (prop === 'borderRightColor') el.style.borderRightColor = rgbValue
          else if (prop === 'borderBottomColor') el.style.borderBottomColor = rgbValue
          else if (prop === 'borderLeftColor') el.style.borderLeftColor = rgbValue
        }
      })

      // Process children
      Array.from(el.children).forEach(child => {
        if (child instanceof HTMLElement) {
          processElement(child)
        }
      })
    }

    processElement(element)
  }

  const downloadPdf = async () => {
    if (!report?.markdown_content) return

    const reportContent = document.getElementById('report-content')
    if (!reportContent) return

    setExporting('pdf')

    try {
      const filename = `${report.title.replace(/[^a-z0-9]/gi, '_')}.pdf`

      // Clone the content to avoid modifying the original
      const clone = reportContent.cloneNode(true) as HTMLElement
      clone.style.position = 'absolute'
      clone.style.left = '-9999px'
      clone.style.top = '0'
      clone.style.width = reportContent.offsetWidth + 'px'
      document.body.appendChild(clone)

      // Convert modern color functions to rgb for html2canvas compatibility
      convertColorsToHex(clone)

      const opt = {
        margin: [0.75, 0.75, 0.75, 0.75] as [number, number, number, number],
        filename,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
        },
        jsPDF: {
          unit: 'in' as const,
          format: 'letter' as const,
          orientation: 'portrait' as const
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }

      await html2pdf().set(opt).from(clone).save()

      // Clean up clone
      document.body.removeChild(clone)
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
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadPdf}
                  disabled={exporting !== null}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#E07A5F] hover:bg-[#C96A4F] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exporting === 'pdf' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  {exporting === 'pdf' ? 'Generating...' : 'Download PDF'}
                </button>
                <button
                  onClick={downloadWord}
                  disabled={exporting !== null}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {exporting === 'docx' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileType className="w-4 h-4" />
                  )}
                  {exporting === 'docx' ? 'Generating...' : 'Download Word'}
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
