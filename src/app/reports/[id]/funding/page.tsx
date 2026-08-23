import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { pickSections, stripTaskListCheckboxes } from '../section-utils'
import { FundingLandscapeView } from './FundingLandscapeView'

interface AgentOutputs {
  projects?: {
    items?: Array<{
      application_id: string
      title: string
      org_name: string | null
      total_cost: number | null
    }>
  }
}

export default async function FundingLandscapePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  // Structured funding stats live on their own column. Narrative body
  // still lives in the assembled markdown — extract it and strip the
  // `##` heading so the view can render its own labeled Analysis
  // block without a duplicated heading.
  const fundingStats = (report.funding_stats ?? null) as
    | React.ComponentProps<typeof FundingLandscapeView>['fundingStats']
    | null

  // Full project sample for the "Top-Funded Organizations" section —
  // lets us list the actual projects under each org instead of an
  // abstract count. Not the whole projects universe, just what's in
  // the analyzed sample.
  const ao = (report.agent_outputs ?? {}) as AgentOutputs
  const allProjects = (ao.projects?.items ?? []) as React.ComponentProps<
    typeof FundingLandscapeView
  >['allProjects']

  const raw = report.markdown_content
    ? pickSections(report.markdown_content, ['NIH Funding Landscape', 'NIH Funding Analysis'])
    : ''
  const narrative = stripTaskListCheckboxes(raw)
    .replace(/^##\s+NIH Funding (?:Landscape|Analysis)\s*\n?/i, '')
    .trim()

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Funding Landscape"
      sectionSubtitle="Where NIH funding flows in this space — trends, category concentration, and top-funded organizations."
      fullMarkdown={report.markdown_content}
    >
      <FundingLandscapeView
        reportId={report.id}
        fundingStats={fundingStats}
        allProjects={allProjects}
        narrative={narrative}
      />
    </SectionShell>
  )
}
