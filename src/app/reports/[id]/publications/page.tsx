import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { PublicationsView } from './PublicationsView'

interface AgentOutputs {
  publications?: {
    totalUniqueJournals?: number
  }
}

export default async function PublicationsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const publications = (report.publications ?? []) as React.ComponentProps<typeof PublicationsView>['publications']
  const curated = (report.curated_publications ?? []) as React.ComponentProps<typeof PublicationsView>['curated']
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Publications"
      sectionSubtitle="PubMed publications linked to the projects, with curated must-reads highlighted."
      fullMarkdown={report.markdown_content}
    >
      <PublicationsView
        publications={publications}
        curated={curated}
        totalUniqueJournals={agentOutputs.publications?.totalUniqueJournals}
      />
    </SectionShell>
  )
}
