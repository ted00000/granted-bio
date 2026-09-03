// Attribution bar rendered at the top of every /reports/[id] view
// when the report is a public marketing sample (is_public_sample=true).
// Sibling to ShareAttributionBar — the two anon-viewer modes each
// get their own bar so the framing matches the visitor's context:
//
//   Share view:   "Shared with you by <sender> · get your own analysis"
//   Sample view:  "← All samples · Sample · get a 3-month platform pass"
//
// The sample bar's left side leads with a prominent "All samples"
// back link (2026-09-03 fix — visitors reported no clear way to
// return to the samples list from within a sample analysis). The
// sidebar has the same link but it's easy to miss; the top bar is
// unmissable and works even when the sidebar is collapsed on mobile.

import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'

export function SampleAttributionBar() {
  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white">
      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/samples"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-[#E07A5F] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
            All samples
          </Link>
          <span className="hidden sm:inline text-gray-300">·</span>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#E07A5F] bg-[#FDF2EF] rounded">
            Sample analysis
          </span>
        </div>
        <Link
          href="/analyze"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#E07A5F] hover:bg-[#C96A4F] rounded-md transition-colors whitespace-nowrap"
        >
          Get your own pass &mdash; $199
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  )
}
