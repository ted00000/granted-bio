import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { CompetitiveTopologyView } from './CompetitiveTopologyView'

interface AgentOutputs {
  competitiveTopology?: {
    clusters: Array<{
      approach: string
      keyPlayers: string[]
      maturityLevel: string
      commercialReadiness: string
    }>
    narrative: string
    strategicImplications?: string
  }
}

export default async function CompetitiveTopologyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs
  const topology = agentOutputs.competitiveTopology ?? null

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Competitive Topology"
      sectionSubtitle="Methodological clusters, key players, and how the space is organized by technical approach."
      fullMarkdown={report.markdown_content}
    >
      <CompetitiveTopologyView reportId={report.id} topology={topology} />
    </SectionShell>
  )
}
