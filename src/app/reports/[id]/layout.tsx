// Portal layout for a single report. Fetches the report once (cached
// so the dashboard + section pages share the round-trip) and wraps
// every child in the persistent sidebar shell.
//
// Deliberately does NOT nest inside AppLayout — while a user is inside
// a report we replace the app-wide sidebar with the topic-scoped one,
// mirroring how portals like Notion / Linear treat "inside a document"
// vs "workspace nav." A "back to All analyses" link in the report
// sidebar handles global escape.
//
// Also serves the share-view surface: when middleware rewrites
// /share/[token] → /reports/[id]/…, `getShareContextFromHeaders`
// returns a valid share row. In that mode we render the same tree
// but with an attribution bar on top, links prefixed with
// /share/[token], and owner-only affordances hidden. The
// ReportViewProvider carries the mode down to every client component.

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { getReport, getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { ReportPortalNav, type SectionCounts } from './ReportPortalNav'
import { ReportViewProvider, type ReportViewCtx } from './ReportViewContext'
import { ShareAttributionBar } from './ShareAttributionBar'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function ReportPortalLayout({
  children,
  params,
}: LayoutProps) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const share = await getShareContextFromHeaders()
  const isShared = share !== null && share.report_id === id

  // Sidebar counts must reflect the FULL analyzed sample, not the
  // truncated top-N slices stored in some columns. Storage layout:
  //   report.projects           -> top 20 by funding (for narrative)
  //   report.top_organizations  -> top 15 by funding
  //   report.top_researchers    -> top 15 by funding
  //   report.clinical_trials    -> full linked trials list
  //   report.patents            -> full linked patents list
  //   report.publications       -> full linked publications list
  // For projects/orgs/researchers pull the total from funding_stats
  // (computed once at generation time against the full retrieval)
  // so the sidebar matches the counts referenced in Field Maturity
  // / Funding Landscape / narrative prose.
  const fs = (report.funding_stats ?? {}) as {
    projectCount?: number
    orgCount?: number
    piCount?: number
  }
  const counts: SectionCounts = {
    projects: fs.projectCount ?? report.project_count ?? (report.projects ?? []).length,
    trials: (report.clinical_trials ?? []).length,
    patents: (report.patents ?? []).length,
    publications: (report.publications ?? []).length,
    organizations: fs.orgCount ?? (report.top_organizations ?? []).length,
    researchers: fs.piCount ?? (report.top_researchers ?? []).length,
  }

  const basePath = isShared ? `/share/${share!.token}` : `/reports/${report.id}`
  // Prefer the sender name captured on the share row (typed in the
  // "Your name" field of the share dialog) over the profile lookup.
  // Falls back to the profile lookup → "A colleague" default when
  // the share was created before we started capturing it.
  const sharedByName = isShared
    ? share!.sender_display_name ?? (await lookupOwnerName(share!.owner_user_id))
    : null
  const backHref = isShared ? null : '/reports'

  const viewCtx: ReportViewCtx = {
    reportId: report.id,
    basePath,
    isShared,
    shareToken: isShared ? share!.token : null,
    sharedByName,
  }

  return (
    <ReportViewProvider value={viewCtx}>
      <div className="fixed inset-0 flex flex-col bg-[#FAFAF9] overflow-hidden">
        {isShared && (
          <ShareAttributionBar
            senderName={sharedByName ?? 'A colleague'}
            reportTopic={report.topic}
          />
        )}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <ReportPortalNav
            reportId={report.id}
            reportTitle={report.title}
            topic={report.topic}
            counts={counts}
            basePath={basePath}
            backHref={backHref}
          />
          <main className="flex-1 min-w-0 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </ReportViewProvider>
  )
}

/**
 * Look up the sender's display name for the attribution bar. Kept
 * inline in the layout because it's the only server-side callsite;
 * duplicates the helper in the shares POST route intentionally (that
 * one is in an API context, this one runs during page render).
 */
async function lookupOwnerName(ownerUserId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('id', ownerUserId)
    .maybeSingle()
  const first = (data?.first_name as string | null | undefined)?.trim()
  const last = (data?.last_name as string | null | undefined)?.trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  return 'A colleague'
}
