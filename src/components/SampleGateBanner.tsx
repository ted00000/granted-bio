// Soft-gate banner shown to logged-out visitors on detail pages
// (/project, /trial, /patent, /publication) when they drill in from the
// sample intelligence report. Data is publicly accessible — the banner
// converts the "keep exploring" moment into an account/signup ask
// instead of a hard auth wall. Sticky under MarketingNav so it persists
// while scrolling without competing with the page's own header.

import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'

export function SampleGateBanner() {
  return (
    <div className="bg-[#E07A5F]/10 border-b border-[#E07A5F]/20 flex-shrink-0">
      <div className="max-w-6xl mx-auto px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="w-4 h-4 text-[#E07A5F] flex-shrink-0" />
          <span className="text-gray-700">
            <span className="font-medium">Exploring the sample report.</span>{' '}
            Create a free account to save findings and generate one on your own
            topic.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-xs text-gray-600 hover:text-gray-900 transition-colors px-2 py-1.5"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E07A5F] hover:bg-[#C96A4F] text-white text-xs font-medium rounded-md transition-colors whitespace-nowrap"
          >
            Get started free
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
