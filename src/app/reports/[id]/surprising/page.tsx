// Structured render for /reports/[id]/surprising — pilot page for the
// new Analysis-page design system (2026-08-15). Departs from the
// PortalSectionView + MarkdownRenderer pattern the other Analysis
// pages still use, and instead extracts each finding as structured
// data (headline, interpretation, confidence, evidence) and renders
// it as its own card via SurprisingFindingsView.
//
// If the pattern lands well, it will be propagated to Field Maturity,
// Funding Landscape, Competitive Topology, White Space, and Market
// Context — same shell, section-specific extractors and renderers.

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getReport } from '@/lib/reports/fetch-report'
import { splitMarkdownSections, extractScopeWarning, stripTaskListCheckboxes } from '../section-utils'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { extractSurprisingFindings, extractSurprisingCaption } from './parse'
import { SurprisingFindingsView } from './SurprisingFindingsView'

export default async function SurprisingSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const md = report.markdown_content ?? ''
  const scopeWarning = extractScopeWarning(md)

  // Extract the "What Surprised Us" section, strip its H2 line, then
  // split caption from findings so each can render in its own slot
  // of the page (subtitle vs. card grid).
  const section = splitMarkdownSections(md).find(
    (s) => s.heading.toLowerCase() === 'what surprised us',
  )
  const rawBody = section
    ? section.body.replace(/^##\s+What Surprised Us\s*\n?/i, '')
    : ''
  const cleanBody = stripTaskListCheckboxes(rawBody)
  const caption = extractSurprisingCaption(cleanBody)
  const findings = extractSurprisingFindings(cleanBody)

  return (
    <div className="min-h-full">
      {/* Section header — mirrors PortalSectionView's shape so
          navigation between pages feels continuous, but this page
          owns the body render. */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5 sm:px-6">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
            <Link
              href={`/reports/${report.id}`}
              className="hover:text-gray-700 transition-colors truncate max-w-xs"
            >
              {report.topic || report.title}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-gray-700">What Surprised Us</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight leading-tight">
            What Surprised Us
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-3xl leading-relaxed">
            Non-obvious findings detected algorithmically from the data. Flagged hypotheses, not verified conclusions.
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {scopeWarning && (
          <div className="mb-6">
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
              <MarkdownRenderer content={scopeWarning} />
            </div>
          </div>
        )}

        <SurprisingFindingsView caption={caption} findings={findings} />
      </div>
    </div>
  )
}
