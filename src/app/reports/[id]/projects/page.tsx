import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { ProjectsView } from './ProjectsView'

export default async function ProjectsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const projects = (report.projects ?? []) as React.ComponentProps<typeof ProjectsView>['projects']
  const fs = (report.funding_stats ?? {}) as { projectCount?: number; total?: number }
  const totalProjects = fs.projectCount ?? report.project_count ?? projects.length
  const totalFunding = fs.total ?? 0

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Projects"
      sectionSubtitle="Top NIH-funded projects in the analyzed sample, ranked by total funding."
      fullMarkdown={report.markdown_content}
    >
      <ProjectsView
        projects={projects}
        totalProjects={totalProjects}
        totalFunding={totalFunding}
      />
    </SectionShell>
  )
}
