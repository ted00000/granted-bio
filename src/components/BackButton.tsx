'use client'

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

// Detail pages (project, org, researcher, patent, publication, trial) used
// to render one-level breadcrumbs which couldn't represent chained
// entity-to-entity navigation honestly. A back button defers to browser
// history (which already tracks the real trail) and falls back to a sane
// landing URL when the user is on the first page of their session
// (deep link / new tab).
//
// We use window.history.length as the "is there history?" signal.
// document.referrer was tempting but doesn't update during Next.js
// client-side navigation — so in a fresh incognito session it stays empty
// across the entire visit, which previously made every detail page
// fall back to /chat instead of calling router.back(), breaking chained
// nav (e.g. /chat → /org → /project where back should land on /org).

interface BackButtonProps {
  fallbackHref?: string
}

export function BackButton({ fallbackHref = '/chat' }: BackButtonProps) {
  const router = useRouter()

  const onClick = () => {
    // length > 1 means at least one entry exists behind the current page
    // in this tab's history (including client-side Next.js navigations).
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#E07A5F] transition-colors"
    >
      <ChevronLeft className="w-4 h-4" />
      Back
    </button>
  )
}
