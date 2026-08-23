import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { ResearchersView } from './ResearchersView'

export default async function ResearchersSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const researchers = (report.top_researchers ?? []) as React.ComponentProps<
    typeof ResearchersView
  >['researchers']
  const fs = (report.funding_stats ?? {}) as { piCount?: number }
  const totalPIs = fs.piCount ?? researchers.length

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Researchers"
      sectionSubtitle="Principal investigators funded in this space, ranked by total NIH funding."
      fullMarkdown={report.markdown_content}
    >
      <ResearchersView reportId={report.id} researchers={researchers} totalPIs={totalPIs} />
    </SectionShell>
  )
}
