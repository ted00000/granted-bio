'use client'

// Smart back button for the scoped org page. Uses router.back() so
// the user returns to the actual page they came from (Funding
// Landscape, Competitive Topology, Projects, Patents, Researchers,
// Organizations list, etc.) rather than a fixed destination.
//
// Fallback: when history is empty (direct link, bookmark, deep-link
// share), send them to the Organizations list — the natural "home"
// for the list.

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

interface BackLinkProps {
  fallbackHref: string
}

export function BackLink({ fallbackHref }: BackLinkProps) {
  const router = useRouter()
  // Track whether there's meaningful history to go back to. On mount,
  // check history.length — the browser reports at least 1 (the current
  // entry) always; > 1 means the user navigated here from somewhere.
  const [hasHistory, setHasHistory] = useState(false)
  useEffect(() => {
    setHasHistory(window.history.length > 1)
  }, [])

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (hasHistory) {
      e.preventDefault()
      router.back()
    }
    // else: let the anchor's default navigation take them to fallback
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-[#E07A5F] transition-colors mb-3"
    >
      <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
      <span>Back</span>
    </a>
  )
}
