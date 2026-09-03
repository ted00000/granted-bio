'use client'

// Client-side view-mode context for the report portal. Every
// component that builds an internal link (sidebar, dashboard tiles,
// section-shell breadcrumb, funding drill-downs, researchers table,
// etc.) reads `basePath` from here so the same tree renders correctly
// under both:
//
//   /reports/[reportId]   (owner view — normal auth)
//   /share/[token]        (share view — middleware-validated)
//
// The server-side layout computes the context once from request
// headers and injects it via <ReportViewProvider>. Client components
// call useReportView() to consume it; server components can also
// read the same values through getReportViewContext() in
// server-context.ts if they need them at render time.

import { createContext, useContext, type ReactNode } from 'react'

export interface ReportViewCtx {
  /** The report ID (owner-view URLs always know this; share-view URLs
   *  hide it in the URL bar but it's the same value under the hood). */
  reportId: string
  /** URL prefix to use when constructing links to sibling section
   *  pages. `/reports/[reportId]` for owner view, `/share/[token]`
   *  for share view. NO trailing slash. */
  basePath: string
  /** True when the current visitor is a share recipient (no auth,
   *  attribution bar visible, owner affordances hidden). */
  isShared: boolean
  /** The middleware-validated share token, or null in owner view.
   *  Client components use this to append ?shareToken=X to fetches
   *  they make against /api/reports/[id] — the API route validates
   *  the token and uses admin-client reads when it's present, so
   *  anonymous recipients can hydrate the dashboard without a
   *  session cookie. */
  shareToken: string | null
  /** Populated in share view only — the sender's display name for
   *  the attribution bar + any share-specific CTAs. Null in owner view. */
  sharedByName: string | null
  /** True when this report is being served as a public marketing
   *  sample (row's is_public_sample flag is set + no auth session
   *  is required). Sibling to isShared: both are anon-viewer modes
   *  but they render different attribution bars and CTAs. Owner
   *  affordances are hidden in both modes. */
  isPublicSample: boolean
}

const ReportViewContext = createContext<ReportViewCtx | null>(null)

export function ReportViewProvider({
  value,
  children,
}: {
  value: ReportViewCtx
  children: ReactNode
}) {
  return <ReportViewContext.Provider value={value}>{children}</ReportViewContext.Provider>
}

/**
 * Hook to consume the current view context. Throws if used outside
 * the provider so a missing-wrap bug surfaces at render time instead
 * of silently rendering broken links.
 */
export function useReportView(): ReportViewCtx {
  const ctx = useContext(ReportViewContext)
  if (!ctx) {
    throw new Error(
      'useReportView must be used inside <ReportViewProvider> (the report portal layout supplies it)'
    )
  }
  return ctx
}
