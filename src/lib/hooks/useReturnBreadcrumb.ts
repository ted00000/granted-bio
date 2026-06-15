'use client'

import { useEffect, useState } from 'react'

// Detail pages (project, org, researcher, patent, publication, trial) link to
// each other via "More from this <X>" CTAs. Without this hook the breadcrumb
// on the destination always read e.g. "Organizations" regardless of where the
// user came from, then linked to the landing page — so clicking it threw away
// the navigation context (e.g. the project they were just on).
//
// The hook prefers the explicit sessionStorage.searchState.returnUrl (set by
// the search/results flow) and falls back to document.referrer when it's on
// the same origin. The label is inferred from the path so "Project" / "Search"
// / etc. shows up correctly regardless of which detail page is current.

const PATH_LABELS: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.startsWith('/project/'), label: 'Project' },
  { test: (p) => p.startsWith('/researcher/'), label: 'Researcher' },
  { test: (p) => p.startsWith('/org/'), label: 'Organization' },
  { test: (p) => p.startsWith('/patent/'), label: 'Patent' },
  { test: (p) => p.startsWith('/publication/'), label: 'Publication' },
  { test: (p) => p.startsWith('/trial/'), label: 'Trial' },
  { test: (p) => p.startsWith('/saved'), label: 'Saved' },
  { test: (p) => p === '/chat' || p.startsWith('/chat?'), label: 'Search' },
]

function labelFor(path: string): string | null {
  for (const entry of PATH_LABELS) {
    if (entry.test(path)) return entry.label
  }
  return null
}

export function useReturnBreadcrumb(
  defaultUrl: string,
  defaultLabel: string
): { returnUrl: string; returnLabel: string } {
  const [returnUrl, setReturnUrl] = useState(defaultUrl)
  const [returnLabel, setReturnLabel] = useState(defaultLabel)

  useEffect(() => {
    const saved = sessionStorage.getItem('searchState')
    if (saved) {
      try {
        const state = JSON.parse(saved)
        if (state.returnUrl) {
          setReturnUrl(state.returnUrl)
          setReturnLabel(labelFor(state.returnUrl) ?? 'Search')
          return
        }
      } catch {
        // fall through to referrer
      }
    }

    if (typeof document !== 'undefined' && document.referrer) {
      try {
        const url = new URL(document.referrer)
        if (url.origin === window.location.origin) {
          const label = labelFor(url.pathname)
          if (label) {
            setReturnUrl(url.pathname + url.search)
            setReturnLabel(label)
          }
        }
      } catch {
        // invalid referrer, keep defaults
      }
    }
  }, [])

  return { returnUrl, returnLabel }
}
