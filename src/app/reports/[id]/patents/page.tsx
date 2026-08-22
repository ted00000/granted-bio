import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { PatentsView } from './PatentsView'

interface AgentOutputs {
  patents?: {
    byAssignee?: Array<{ assignee: string; count: number }>
    recentCount?: number
  }
}

export default async function PatentsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const patents = (report.patents ?? []) as React.ComponentProps<typeof PatentsView>['patents']
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Patents"
      sectionSubtitle="USPTO patents linked to the projects in this analysis sample."
      fullMarkdown={report.markdown_content}
    >
      <PatentsView
        patents={patents}
        byAssignee={agentOutputs.patents?.byAssignee}
        recentCount={agentOutputs.patents?.recentCount}
      />
    </SectionShell>
  )
}
