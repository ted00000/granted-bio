// Shared shell for every Analysis section page — provides the sticky
// header (breadcrumb + H1 + subtitle), the scope-warning banner if
// applicable, and the outer container. The bespoke section views
// (Field Maturity, Competitive Topology, Funding Landscape, White
// Space, Market Context) render whatever body content they need
// inside {children}.
//
// This is what PortalSectionView does for pages that still use the
// markdown-slice pattern. When those pages get their own bespoke
// treatment they switch to SectionShell so the layout stays
// consistent while the body render is custom.

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { extractScopeWarning } from './section-utils'
import { getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { PrintButton } from '@/components/PrintButton'

interface SectionShellProps {
  reportId: string
  reportTopic: string | null
  reportTitle: string
  /** Human-facing section title shown at the top of the main area. */
  sectionLabel: string
  /** One-sentence positioning line under the section title. */
  sectionSubtitle: string
  /** The full assembled markdown from the report row — used to detect
      the scope-warning banner. Pass null when unavailable. */
  fullMarkdown: string | null
  children: React.ReactNode
}

export async function SectionShell({
  reportId,
  reportTopic,
  reportTitle,
  sectionLabel,
  sectionSubtitle,
  fullMarkdown,
  children,
}: SectionShellProps) {
  const scopeWarning = fullMarkdown ? extractScopeWarning(fullMarkdown) : ''
  // Prefix the breadcrumb "back to dashboard" link with the share
  // token when viewing in shared mode, so client-side nav from a
  // shared section stays inside /share/[token]/….
  const share = await getShareContextFromHeaders()
  const basePath = share && share.report_id === reportId
    ? `/share/${share.token}`
    : `/reports/${reportId}`

  return (
    <div className="min-h-full">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                <Link
                  href={basePath}
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
            {/* Print — always visible (owner + share recipient). CSS
                @media print hides it from the printed output. */}
            <PrintButton className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#E07A5F] transition-colors mt-1" />
          </div>
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
        {children}
      </div>
    </div>
  )
}
