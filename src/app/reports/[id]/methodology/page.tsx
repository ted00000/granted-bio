import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { PortalSectionView } from '../PortalSectionView'

interface FundingStats { byYear?: unknown; byCategory?: unknown }
interface AgentOutputs { trials?: { byPhase?: Record<string, number> } }

export default async function MethodologySectionPage({
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
      sectionLabel="Methodology & Coverage"
      sectionSubtitle="How this analysis was generated, what it does and does not cover, confidence framework."
      // These are the boilerplate + methodology sections. Keeping them
      // together on a dedicated page frees the dashboard from having
      // to interleave caveats between substantive findings.
      markdownSections={[
        'How to Use This Report',
        'What This Report Does Not Cover',
        'About This Report',
      ]}
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
