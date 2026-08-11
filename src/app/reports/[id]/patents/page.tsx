import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { PortalSectionView } from '../PortalSectionView'

interface FundingStats { byYear?: unknown; byCategory?: unknown }
interface AgentOutputs { trials?: { byPhase?: Record<string, number> } }

export default async function PatentsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const fundingStats = (report.funding_stats ?? {}) as FundingStats
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs

  return (
    <PortalSectionView
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Patents"
      sectionSubtitle="USPTO patents linked to the projects, assignees, and IP concentration."
      // Researcher persona emits "Patent Activity"; investor persona
      // emits "IP Landscape". Extract both — only one will match per
      // report, so the missing one is silently skipped.
      markdownSections={['Patent Activity', 'IP Landscape']}
      fullMarkdown={report.markdown_content}
      chartData={{
        fundingByYear: fundingStats.byYear,
        categories: fundingStats.byCategory,
        trialsByPhase: agentOutputs.trials?.byPhase,
        whiteSpace: (agentOutputs as { whiteSpace?: unknown })?.whiteSpace as never,
      }}
    />
  )
}
