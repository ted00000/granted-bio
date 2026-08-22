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

  const orgs = (report.top_organizations ?? []) as React.ComponentProps<typeof OrganizationsView>['orgs']
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
      <OrganizationsView orgs={orgs} totalOrgs={totalOrgs} />
    </SectionShell>
  )
}
