import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { pickSections, stripTaskListCheckboxes } from '../section-utils'
import { FundingLandscapeView } from './FundingLandscapeView'

export default async function FundingLandscapePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const fundingStats = (report.funding_stats ?? null) as
    | React.ComponentProps<typeof FundingLandscapeView>['fundingStats']
    | null

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
        narrative={narrative}
      />
    </SectionShell>
  )
}
