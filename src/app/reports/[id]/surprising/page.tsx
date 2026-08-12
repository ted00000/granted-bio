import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { PortalSectionView } from '../PortalSectionView'

interface FundingStats { byYear?: unknown; byCategory?: unknown }
interface AgentOutputs { trials?: { byPhase?: Record<string, number> } }

export default async function SurprisingSectionPage({
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
      sectionLabel="What Surprised Us"
      sectionSubtitle="Non-obvious findings detected algorithmically from the data. Flagged hypotheses, not verified conclusions."
      markdownSections={['What Surprised Us']}
      fullMarkdown={report.markdown_content}
      chartData={{
        fundingByYear: fundingStats.byYear,
        categories: fundingStats.byCategory,
        trialsByPhase: agentOutputs.trials?.byPhase,
        whiteSpace: (agentOutputs as { whiteSpace?: unknown })?.whiteSpace as never,
      }}
      emptyMessage="This analysis did not surface any surprising findings — most commonly because the sample size was small or all signals fell within expected patterns."
    />
  )
}
