import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { WhiteSpaceView } from './WhiteSpaceView'

interface AgentOutputs {
  whiteSpace?: React.ComponentProps<typeof WhiteSpaceView>['whiteSpace']
}

export default async function WhiteSpaceSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs
  const whiteSpace = agentOutputs.whiteSpace ?? null

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="White Space"
      sectionSubtitle="Coverage-gap analysis: dimensions and categories under-represented in this sample."
      fullMarkdown={report.markdown_content}
    >
      <WhiteSpaceView whiteSpace={whiteSpace} />
    </SectionShell>
  )
}
