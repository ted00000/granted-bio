'use client'

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// Detail pages (project, org, researcher, patent, publication, trial) used
// to render one-level breadcrumbs which couldn't represent chained
// entity-to-entity navigation honestly. A back button defers to browser
// history (which already tracks the real trail) and falls back to a sane
// landing URL when there's no same-origin referrer (deep link / new tab).

interface BackButtonProps {
  fallbackHref?: string
}

export function BackButton({ fallbackHref = '/chat' }: BackButtonProps) {
  const router = useRouter()
  // hasHistory tracks whether router.back() will land somewhere useful.
  // We treat "useful" as: same-origin referrer is present. External
  // referrer (Google, etc.) or no referrer (typed URL, fresh tab) means
  // history.back() either leaves the app or does nothing — fallback to a
  // known landing route instead.
  const [hasHistory, setHasHistory] = useState(true)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!document.referrer) {
      setHasHistory(false)
      return
    }
    try {
      const url = new URL(document.referrer)
      if (url.origin !== window.location.origin) {
        setHasHistory(false)
      }
    } catch {
      setHasHistory(false)
    }
  }, [])

  const onClick = () => {
    if (hasHistory) {
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
