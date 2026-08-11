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

  const counts: SectionCounts = {
    projects: (report.projects ?? []).length,
    trials: (report.clinical_trials ?? []).length,
    patents: (report.patents ?? []).length,
    publications: (report.publications ?? []).length,
    organizations: (report.top_organizations ?? []).length,
    researchers: (report.top_researchers ?? []).length,
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
