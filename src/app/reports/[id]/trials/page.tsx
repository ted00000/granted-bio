import { notFound } from 'next/navigation'
import { getReport, getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { TrialsView } from './TrialsView'

interface AgentOutputs {
  trials?: {
    byPhase?: Record<string, number>
    byStatus?: Record<string, number>
  }
}

export default async function TrialsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const trials = (report.clinical_trials ?? []) as React.ComponentProps<typeof TrialsView>['trials']
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs
  // TrialsView is a client component (phase chips are interactive
  // filters). Resolve the server-only share context here and thread
  // inShare through as a prop.
  const inShare = !!(await getShareContextFromHeaders())

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Clinical Trials"
      sectionSubtitle="ClinicalTrials.gov studies linked to the NIH projects in this sample. Click a phase chip below to filter."
      fullMarkdown={report.markdown_content}
    >
      <TrialsView
        trials={trials}
        byPhase={agentOutputs.trials?.byPhase}
        byStatus={agentOutputs.trials?.byStatus}
        inShare={inShare}
      />
    </SectionShell>
  )
}
