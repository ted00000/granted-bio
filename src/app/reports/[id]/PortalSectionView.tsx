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
      {/* Section header. Sticky at top of the scrollable main so the
          reader always sees the breadcrumb + section title when they
          navigate mid-scroll. Editorial rhythm: small uppercase
          section label, larger H1 (tight tracking), one-line subtitle
          in muted gray. Mirrors the Analyses portal's app-wide
          typography. */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5 sm:px-6">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
            <Link
              href={`/reports/${reportId}`}
              className="hover:text-gray-700 transition-colors truncate max-w-xs"
            >
              {reportTopic || reportTitle}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-gray-700">{sectionLabel}</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight leading-tight">
            {sectionLabel}
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-3xl leading-relaxed">
            {sectionSubtitle}
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {scopeWarning && (
          <div className="mb-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <MarkdownRenderer content={scopeWarning} compact />
            </div>
          </div>
        )}
        {hasContent ? (
          // White content card with generous padding. The old
          // shadow-sm alone read as thin; combined the border + light
          // shadow gives the block a bit more presence without
          // shouting.
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-8 py-7">
            <MarkdownRenderer content={body} chartData={chartData as never} compact />
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center">
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
