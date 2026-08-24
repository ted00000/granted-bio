// The bar that sits at the top of every /share/[token] view. Two
// jobs:
//
//   1. Attribute the analysis to the sender by name. Making the
//      sharer visible (on both marketing and social channels) makes
//      the share feel personal, and makes broadcast-style posting
//      feel socially awkward — the recipient sees who forwarded it,
//      and any screenshot carries the sender's name across the top.
//
//   2. Give the recipient a low-friction path to their own analysis.
//      "Get your own analysis on [topic]" routes to /analyze with the
//      topic pre-filled. The whole point of shipping share is that
//      it's marketing — the CTA converts curiosity into a lead.
//
// Rendered as a compact horizontal strip above the report portal
// (outside the ReportPortalNav sidebar). Sticky feel isn't required;
// it just needs to be present and readable at the top.

import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { ArrowRight } from 'lucide-react'

interface ShareAttributionBarProps {
  senderName: string
  reportTopic: string | null
}

export function ShareAttributionBar({ senderName, reportTopic }: ShareAttributionBarProps) {
  // Build the analyze CTA with the topic pre-filled when we have one.
  // No ?generate=1 — the recipient hasn't signed up yet, so we take
  // them to the topic-picker rather than firing the modal blind.
  const ctaHref = reportTopic
    ? `/analyze?topic=${encodeURIComponent(reportTopic)}`
    : '/analyze'

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white">
      <div className="max-w-[100rem] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Logo height={20} />
          <span className="hidden sm:inline text-gray-300">|</span>
          <div className="text-sm text-gray-700 truncate">
            Shared with you by <span className="font-semibold text-gray-900">{senderName}</span>
          </div>
        </div>
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#E07A5F] hover:bg-[#FDF2EF] rounded-md transition-colors whitespace-nowrap"
        >
          {reportTopic ? 'Get your own analysis' : 'Start your own analysis'}
          <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  )
}
