// Reusable render surface for a portal section page. Every section page
// (Projects, Trials, Patents, etc.) uses this component to render its
// slice of the report — a consistent header + a MarkdownRenderer with
// section-scoped content.
//
// v1 extracts the relevant sections from the assembled markdown so we
// ship the portal shape without re-doing all the per-section
// visualization work. v2 will replace the markdown slice with proper
// structured tables (sort, filter, drill-in) per section. Same shell,
// different body — the routes stay stable across the upgrade.

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { pickSections, extractScopeWarning } from './section-utils'

interface PortalSectionViewProps {
  reportId: string
  reportTopic: string | null
  reportTitle: string
  /** Human-facing section title shown at the top of the main area. */
  sectionLabel: string
  /**
   * One-sentence positioning line under the section title. Explains
   * what the reader is looking at in the context of the whole analysis.
   */
  sectionSubtitle: string
  /**
   * Ordered list of `## `-heading names to extract from the report's
   * markdown and render as this section's body. Missing headings are
   * skipped silently, so persona variants that omit a section just
   * render less content instead of erroring.
   */
  markdownSections: string[]
  /** The full assembled markdown from the report row. */
  fullMarkdown: string | null
  /** Chart data for any charts embedded in the sliced markdown. */
  chartData: {
    fundingByYear?: unknown
    categories?: unknown
    trialsByPhase?: unknown
    whiteSpace?: unknown
  }
  /**
   * When true, render a small "empty state" message when the requested
   * sections aren't present in this report's markdown (rather than an
   * empty white card). Useful for persona-conditional sections like
   * "Investment Thesis" that only exist in investor reports.
   */
  emptyMessage?: string
}

export function PortalSectionView({
  reportId,
  reportTopic,
  reportTitle,
  sectionLabel,
  sectionSubtitle,
  markdownSections,
  fullMarkdown,
  chartData,
  emptyMessage,
}: PortalSectionViewProps) {
  const scopeWarning = fullMarkdown ? extractScopeWarning(fullMarkdown) : ''
  const body = fullMarkdown ? pickSections(fullMarkdown, markdownSections) : ''
  const hasContent = body.trim().length > 0

  return (
    <div className="min-h-full">
      {/* Section header — mirrors dashboard's structure so navigation
          between sections feels continuous. Breadcrumb links back
          to the dashboard so the reader always has an anchor home. */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
            <Link
              href={`/reports/${reportId}`}
              className="hover:text-gray-800 transition-colors truncate max-w-xs"
            >
              {reportTopic || reportTitle}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-gray-800 font-medium">{sectionLabel}</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">{sectionLabel}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{sectionSubtitle}</p>
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
        {hasContent ? (
          <div className="bg-white rounded-lg shadow-sm">
            <MarkdownRenderer content={body} chartData={chartData as never} />
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <p className="text-sm text-gray-500">
              {emptyMessage ||
                `This analysis does not include a ${sectionLabel.toLowerCase()} section.`}
            </p>
            <Link
              href={`/reports/${reportId}`}
              className="inline-block mt-3 text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Back to Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
