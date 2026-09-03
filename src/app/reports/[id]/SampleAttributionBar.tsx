// Attribution bar rendered at the top of every /reports/[id] view
// when the report is a public marketing sample (is_public_sample=true).
// Sibling to ShareAttributionBar — the two anon-viewer modes each
// get their own bar so the framing matches the visitor's context:
//
//   Share view:   "Shared with you by <sender> · get your own analysis"
//   Sample view:  "Sample analysis · get a 3-month platform pass — $199"
//
// Sample bar leans harder on the conversion CTA — visitors are on a
// marketing surface expecting to see the product. Attribution to a
// "sender" doesn't apply (there isn't one).

import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { ArrowRight } from 'lucide-react'

export function SampleAttributionBar() {
  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white">
      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Logo height={20} />
          <span className="hidden sm:inline text-gray-300">|</span>
          <div className="text-sm text-gray-700 truncate">
            <span className="font-semibold text-gray-900">Sample analysis.</span>{' '}
            <span className="hidden sm:inline">
              This is exactly what a 3-month platform pass includes.
            </span>
          </div>
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
