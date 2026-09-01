import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { OrganizationsView } from './OrganizationsView'

export default async function OrganizationsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  // Curated top-N (top-15 by activity) is the default view. The full
  // sorted list lives in `all_organizations` (populated for reports
  // generated after 2026-09-01); when present the OrganizationsTable
  // renders a "Show all N" toggle with pagination.
  const orgs = (report.top_organizations ?? []) as React.ComponentProps<typeof OrganizationsView>['orgs']
  const allOrgs = (report.all_organizations ?? null) as React.ComponentProps<typeof OrganizationsView>['allOrgs']
  const fs = (report.funding_stats ?? {}) as { orgCount?: number }
  const totalOrgs = fs.orgCount ?? orgs.length

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Organizations"
      sectionSubtitle="Institutions with the largest presence in this NIH-funded sample."
      fullMarkdown={report.markdown_content}
    >
      <OrganizationsView
        reportId={report.id}
        orgs={orgs}
        allOrgs={allOrgs}
        totalOrgs={totalOrgs}
      />
    </SectionShell>
  )
}
