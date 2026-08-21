import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { FieldMaturityView } from './FieldMaturityView'

interface AgentOutputs {
  fieldMaturity?: {
    trlEstimate: string
    maturityNarrative: string
    benchmarkComparison?: string
    evidenceSummary: {
      preprintRatio: string
      trialProgression: string
      patentActivity: string
    }
    strategicImplications?: string
    overallAssessment: 'nascent' | 'emerging' | 'maturing' | 'established'
  }
}

export default async function FieldMaturityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs
  const fm = agentOutputs.fieldMaturity ?? null

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Field Maturity"
      sectionSubtitle="Where this space sits on the nascent-to-established spectrum, and the signals that place it there."
      fullMarkdown={report.markdown_content}
    >
      <FieldMaturityView fieldMaturity={fm} />
    </SectionShell>
  )
}
