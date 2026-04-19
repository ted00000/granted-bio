'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { FileText, AlertCircle, FileDown, Loader2, FileType } from 'lucide-react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MarkdownRenderer } from './MarkdownRenderer'
import { jsPDF } from 'jspdf'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, Header, Footer, AlignmentType } from 'docx'
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
      const headerHeight = 40
      const footerHeight = 36
      let y = margin + headerHeight
      let isFirstElement = true
      const currentYear = new Date().getFullYear()
      const brandColor: [number, number, number] = [224, 122, 95] // #E07A5F

      // Helper to add header and footer to content pages (not cover)
      const addPageBranding = (pageNum: number) => {
        // Header - "granted.bio" text logo
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(17, 24, 39)
        doc.text('granted', margin, margin + 12)
        const grantedWidth = doc.getTextWidth('granted')
        doc.setTextColor(...brandColor)
        doc.text('.bio', margin + grantedWidth, margin + 12)

        // Report title on right
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(107, 114, 128)
        const shortTitle = report.title.length > 40 ? report.title.slice(0, 40) + '...' : report.title
        const titleWidth = doc.getTextWidth(shortTitle)
        doc.text(shortTitle, pageWidth - margin - titleWidth, margin + 12)

        // Header line
        doc.setDrawColor(229, 231, 235)
        doc.setLineWidth(0.5)
        doc.line(margin, margin + 24, pageWidth - margin, margin + 24)

        // Footer line
        doc.setDrawColor(229, 231, 235)
        doc.line(margin, pageHeight - margin, pageWidth - margin, pageHeight - margin)

        // Footer - Page number centered, copyright on left
        doc.setFontSize(8)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(156, 163, 175)
        doc.text(`© ${currentYear} Granted Bio`, margin, pageHeight - margin + 14)

        // Page number centered
        const pageText = `Page ${pageNum}`
        const pageTextWidth = doc.getTextWidth(pageText)
        doc.text(pageText, (pageWidth - pageTextWidth) / 2, pageHeight - margin + 14)

        // Generated date on right
        const dateText = formatDate(report.created_at)
        const dateWidth = doc.getTextWidth(dateText)
        doc.text(dateText, pageWidth - margin - dateWidth, pageHeight - margin + 14)
      }

      // ========== COVER PAGE ==========
      const centerX = pageWidth / 2

      // Top accent line
      doc.setDrawColor(...brandColor)
      doc.setLineWidth(4)
      doc.line(margin, 80, pageWidth - margin, 80)

      // "INTELLIGENCE REPORT" label
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...brandColor)
      const labelText = 'INTELLIGENCE REPORT'
      const labelWidth = doc.getTextWidth(labelText)
      doc.text(labelText, centerX - labelWidth / 2, 120)

      // Main title (the topic)
      doc.setFontSize(32)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(17, 24, 39)
      const titleLines = doc.splitTextToSize(report.title, maxWidth - 40)
      const titleStartY = 180
      titleLines.forEach((line: string, idx: number) => {
        const lineWidth = doc.getTextWidth(line)
        doc.text(line, centerX - lineWidth / 2, titleStartY + idx * 40)
      })

      // Subtitle / date
      const subtitleY = titleStartY + titleLines.length * 40 + 30
      doc.setFontSize(12)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(107, 114, 128)
      const dateStr = formatDate(report.created_at)
      const dateStrWidth = doc.getTextWidth(dateStr)
      doc.text(dateStr, centerX - dateStrWidth / 2, subtitleY)

      // Key metrics box
      const metricsY = subtitleY + 60
      const metricsBoxWidth = 200
      const metricsBoxHeight = 80
      const metricsBoxX = centerX - metricsBoxWidth / 2

      doc.setDrawColor(229, 231, 235)
      doc.setLineWidth(1)
      doc.roundedRect(metricsBoxX, metricsY, metricsBoxWidth, metricsBoxHeight, 8, 8, 'S')

      if (report.project_count !== null) {
        doc.setFontSize(28)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(17, 24, 39)
        const countStr = report.project_count.toLocaleString()
        const countWidth = doc.getTextWidth(countStr)
        doc.text(countStr, centerX - countWidth / 2, metricsY + 38)

        doc.setFontSize(11)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(107, 114, 128)
        const projectsLabel = 'Projects Analyzed'
        const projectsWidth = doc.getTextWidth(projectsLabel)
        doc.text(projectsLabel, centerX - projectsWidth / 2, metricsY + 58)
      }

      // Bottom branding
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(17, 24, 39)
      const brandGranted = 'granted'
      const brandBio = '.bio'
      const brandGrantedWidth = doc.getTextWidth(brandGranted)
      doc.setTextColor(...brandColor)
      const brandBioWidth = doc.getTextWidth(brandBio)
      const totalBrandWidth = brandGrantedWidth + brandBioWidth
      doc.setTextColor(17, 24, 39)
      doc.text(brandGranted, centerX - totalBrandWidth / 2, pageHeight - 100)
      doc.setTextColor(...brandColor)
      doc.text(brandBio, centerX - totalBrandWidth / 2 + brandGrantedWidth, pageHeight - 100)

      // Tagline
      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(107, 114, 128)
      const tagline = 'Life Sciences Intelligence Platform'
      const taglineWidth = doc.getTextWidth(tagline)
      doc.text(tagline, centerX - taglineWidth / 2, pageHeight - 82)

      // Bottom accent line
      doc.setDrawColor(...brandColor)
      doc.setLineWidth(4)
      doc.line(margin, pageHeight - 50, pageWidth - margin, pageHeight - 50)

      // ========== TABLE OF CONTENTS ==========
      // Parse headers to build TOC
      const tocLines = report.markdown_content.split('\n')
      const tocItems: { level: number; text: string; pageNum: number }[] = []

      // First pass: identify H1 and H2 headers for TOC
      tocLines.forEach((tocLine) => {
        const tocTrimmed = tocLine.trim()
        if (tocTrimmed.startsWith('## ')) {
          tocItems.push({ level: 2, text: tocTrimmed.slice(3), pageNum: 0 }) // Page nums calculated during render
        } else if (tocTrimmed.startsWith('# ')) {
          tocItems.push({ level: 1, text: tocTrimmed.slice(2), pageNum: 0 })
        }
      })

      // Only add TOC if we have enough sections
      let contentStartPage = 2
      if (tocItems.length >= 3) {
        doc.addPage()
        contentStartPage = 3

        // TOC header
        doc.setFontSize(20)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(17, 24, 39)
        doc.text('Table of Contents', margin, 80)

        // Accent line under TOC title
        doc.setDrawColor(...brandColor)
        doc.setLineWidth(2)
        doc.line(margin, 92, margin + 120, 92)

        let tocY = 130
        tocItems.forEach((item, idx) => {
          doc.setFontSize(item.level === 1 ? 12 : 11)
          doc.setFont('helvetica', item.level === 1 ? 'bold' : 'normal')
          doc.setTextColor(55, 65, 81)

          const indent = item.level === 1 ? 0 : 16
          const bulletChar = item.level === 1 ? '' : '•  '
          const displayText = bulletChar + item.text

          doc.text(displayText, margin + indent, tocY)
          tocY += item.level === 1 ? 28 : 22
        })

        // Add TOC footer
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(156, 163, 175)
        doc.text('Note: This report was generated by AI analysis of publicly available data.', margin, pageHeight - margin - 20)
      }

      // ========== CONTENT PAGES ==========
      doc.addPage()
      let currentPageNum = contentStartPage
      addPageBranding(currentPageNum)
      y = margin + headerHeight

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

      const bottomMargin = 72 + footerHeight // Account for footer space
      const addNewPageIfNeeded = (height: number) => {
        if (y + height > pageHeight - bottomMargin) {
          doc.addPage()
          currentPageNum++
          addPageBranding(currentPageNum)
          y = margin + headerHeight
          return true
        }
        return false
      }

      // Helper to force new page for major sections
      const forceNewPage = () => {
        doc.addPage()
        currentPageNum++
        addPageBranding(currentPageNum)
        y = margin + headerHeight
      }

      // Track if we should add page break before next H1/H2
      let contentRendered = false

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

        // H1 Header - Major section, force page break if not first
        if (trimmed.startsWith('# ')) {
          if (contentRendered && y > margin + headerHeight + 100) {
            // Force new page for major sections (unless near top)
            forceNewPage()
          } else if (!isFirstElement) {
            y += 20
          }
          addNewPageIfNeeded(36)

          // Draw accent bar on left
          doc.setFillColor(...brandColor)
          doc.rect(margin, y - 6, 4, 28, 'F')

          doc.setFontSize(18)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth - 12)
          doc.text(splitText, margin + 12, y)
          y += splitText.length * 22 + 12
          isFirstElement = false
          contentRendered = true
          i++
          continue
        }

        // H2 Header - Section header with subtle background
        if (trimmed.startsWith('## ')) {
          y += 18
          addNewPageIfNeeded(32)

          // Subtle background bar
          doc.setFillColor(249, 250, 251) // gray-50
          doc.rect(margin, y - 10, maxWidth, 26, 'F')

          // Left accent line
          doc.setFillColor(...brandColor)
          doc.rect(margin, y - 10, 3, 26, 'F')

          doc.setFontSize(14)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(17, 24, 39)
          const text = cleanText(trimmed.slice(3))
          const splitText = doc.splitTextToSize(text, maxWidth - 10)
          doc.text(splitText, margin + 10, y)
          y += splitText.length * 18 + 10
          isFirstElement = false
          contentRendered = true
          i++
          continue
        }

        // H3 Header
        if (trimmed.startsWith('### ')) {
          y += 12
          addNewPageIfNeeded(20)
          doc.setFontSize(12)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(55, 65, 81)
          const text = cleanText(trimmed.slice(4))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 15 + 8
          isFirstElement = false
          contentRendered = true
          i++
          continue
        }

        // H4 Header
        if (trimmed.startsWith('#### ')) {
          y += 8
          addNewPageIfNeeded(18)
          doc.setFontSize(11)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor(75, 85, 99)
          const text = cleanText(trimmed.slice(5))
          const splitText = doc.splitTextToSize(text, maxWidth)
          doc.text(splitText, margin, y)
          y += splitText.length * 14 + 6
          isFirstElement = false
          contentRendered = true
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
          addNewPageIfNeeded(22)
          doc.setFontSize(10)
          doc.setFont('helvetica', 'italic')
          doc.setTextColor(75, 85, 99)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth - 20)
          const blockHeight = splitText.length * 13 + 8

          // Light background
          doc.setFillColor(254, 242, 239) // Very light brand color
          doc.roundedRect(margin, y - 8, maxWidth, blockHeight + 4, 4, 4, 'F')

          // Brand-colored left border
          doc.setFillColor(...brandColor)
          doc.rect(margin, y - 8, 4, blockHeight + 4, 'F')

          doc.text(splitText, margin + 14, y)
          y += blockHeight + 8
          doc.setTextColor(0, 0, 0)
          isFirstElement = false
          contentRendered = true
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
            const lineHeight = 12
            const cellPaddingTop = 7
            const cellPaddingBottom = 9

            // Detect numeric columns (for right-alignment)
            const numericCols: boolean[] = []
            for (let col = 0; col < colCount; col++) {
              // Check if most non-header cells in this column are numeric
              let numericCount = 0
              for (let row = 1; row < tableData.length; row++) {
                const cell = tableData[row][col] || ''
                // Match numbers, currencies, percentages
                if (cell.match(/^[\$€£]?[\d,]+\.?\d*%?$/) || cell.match(/^\d+[KMB]?\+?$/i)) {
                  numericCount++
                }
              }
              numericCols[col] = numericCount > (tableData.length - 1) / 2
            }

            // Pre-calculate row heights based on wrapped content
            const rowHeights: number[] = tableData.map((row) => {
              let maxLines = 1
              row.forEach((cell) => {
                doc.setFontSize(10)
                const wrapped = doc.splitTextToSize(cell, colWidth - 12)
                maxLines = Math.max(maxLines, wrapped.length)
              })
              return maxLines * lineHeight + cellPaddingTop + cellPaddingBottom
            })

            // Draw table border (top)
            doc.setDrawColor(...brandColor)
            doc.setLineWidth(1.5)
            doc.line(margin, y, margin + maxWidth, y)

            // Draw table row by row with proper heights
            tableData.forEach((row, rowIndex) => {
              const rowHeight = rowHeights[rowIndex]

              // Check if row fits, add new page if needed
              if (y + rowHeight > pageHeight - bottomMargin) {
                doc.addPage()
                currentPageNum++
                addPageBranding(currentPageNum)
                y = margin + headerHeight
                // Redraw top border on new page
                doc.setDrawColor(...brandColor)
                doc.setLineWidth(1.5)
                doc.line(margin, y, margin + maxWidth, y)
              }

              const rowTop = y

              // Row backgrounds
              if (rowIndex === 0) {
                // Header row - brand color tint
                doc.setFillColor(254, 242, 239) // Very light brand color
                doc.rect(margin, rowTop, maxWidth, rowHeight, 'F')
              } else if (rowIndex % 2 === 0) {
                // Alternating rows
                doc.setFillColor(249, 250, 251) // gray-50
                doc.rect(margin, rowTop, maxWidth, rowHeight, 'F')
              }

              // Cell text - positioned with top padding
              doc.setFontSize(10)
              doc.setFont('helvetica', rowIndex === 0 ? 'bold' : 'normal')
              doc.setTextColor(rowIndex === 0 ? 17 : 55, rowIndex === 0 ? 24 : 65, rowIndex === 0 ? 39 : 81)

              row.forEach((cell, colIndex) => {
                const cellX = margin + colIndex * colWidth
                const cellText = doc.splitTextToSize(cell, colWidth - 12)

                // Right-align numeric columns (except header)
                const isNumeric = numericCols[colIndex] && rowIndex > 0

                cellText.forEach((textLine: string, lineIndex: number) => {
                  const textY = rowTop + cellPaddingTop + lineHeight * 0.8 + lineIndex * lineHeight
                  if (isNumeric) {
                    const textWidth = doc.getTextWidth(textLine)
                    doc.text(textLine, cellX + colWidth - 8 - textWidth, textY)
                  } else {
                    doc.text(textLine, cellX + 6, textY)
                  }
                })
              })

              // Row border at bottom of row
              doc.setDrawColor(229, 231, 235)
              doc.setLineWidth(0.5)
              doc.line(margin, rowTop + rowHeight, margin + maxWidth, rowTop + rowHeight)

              y = rowTop + rowHeight
            })

            y += 12
          }
          isFirstElement = false
          contentRendered = true
          continue
        }

        // List item
        if (trimmed.match(/^[-*] /)) {
          addNewPageIfNeeded(16)
          doc.setFontSize(10.5)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(55, 65, 81)
          const text = cleanText(trimmed.slice(2))
          const splitText = doc.splitTextToSize(text, maxWidth - 14)
          // Brand-colored bullet
          doc.setTextColor(...brandColor)
          doc.text('•', margin, y)
          doc.setTextColor(55, 65, 81)
          doc.text(splitText, margin + 14, y)
          y += splitText.length * 13 + 4
          isFirstElement = false
          contentRendered = true
          i++
          continue
        }

        // Regular paragraph
        addNewPageIfNeeded(16)
        doc.setFontSize(10.5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(55, 65, 81)
        const text = cleanText(trimmed)
        const splitText = doc.splitTextToSize(text, maxWidth)
        doc.text(splitText, margin, y)
        y += splitText.length * 13 + 5
        isFirstElement = false
        contentRendered = true
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

      const currentYear = new Date().getFullYear()
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
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: 'granted', bold: true, size: 22 }),
                      new TextRun({ text: '.bio', bold: true, size: 22, color: 'E07A5F' }),
                    ],
                    border: {
                      bottom: {
                        color: 'E5E7EB',
                        size: 6,
                        style: BorderStyle.SINGLE,
                        space: 8,
                      },
                    },
                    spacing: { after: 200 },
                  }),
                ],
              }),
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `© ${currentYear} Granted Bio. All rights reserved.`,
                        size: 16,
                        color: '9CA3AF',
                      }),
                    ],
                    border: {
                      top: {
                        color: 'E5E7EB',
                        size: 6,
                        style: BorderStyle.SINGLE,
                        space: 8,
                      },
                    },
                    alignment: AlignmentType.CENTER,
                  }),
                ],
              }),
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
              <Breadcrumbs
                items={[
                  { label: 'Reports', href: '/reports' },
                  { label: 'Report' },
                ]}
              />
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
            <Breadcrumbs
              items={[
                { label: 'Reports', href: '/reports' },
                { label: report.title.length > 30 ? report.title.slice(0, 30) + '...' : report.title },
              ]}
            />
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
