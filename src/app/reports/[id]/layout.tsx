// Portal layout for a single report. Fetches the report once (cached
// so the dashboard + section pages share the round-trip) and wraps
// every child in the persistent sidebar shell.
//
// Deliberately does NOT nest inside AppLayout — while a user is inside
// a report we replace the app-wide sidebar with the topic-scoped one,
// mirroring how portals like Notion / Linear treat "inside a document"
// vs "workspace nav." A "back to All analyses" link in the report
// sidebar handles global escape.

import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { ReportPortalNav, type SectionCounts } from './ReportPortalNav'

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

  return (
    <div className="fixed inset-0 flex bg-[#FAFAF9] overflow-hidden">
      <ReportPortalNav
        reportId={report.id}
        reportTitle={report.title}
        topic={report.topic}
        counts={counts}
        backHref="/reports"
      />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
