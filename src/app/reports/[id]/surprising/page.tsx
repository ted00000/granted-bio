// Structured render for /reports/[id]/surprising — extracts each
// finding as structured data (headline, interpretation, confidence,
// evidence) and renders it as its own card via SurprisingFindingsView.
//
// Uses SectionShell (like every other bespoke section page) so the
// header, breadcrumb, Print button, and scope-warning banner render
// consistently with the rest of the portal. Earlier revisions of this
// page inlined the header before SectionShell existed; unified after
// noticing the Print button was missing here but present everywhere
// else.

import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { splitMarkdownSections, stripTaskListCheckboxes } from '../section-utils'
import { SectionShell } from '../SectionShell'
import { extractSurprisingFindings, extractSurprisingCaption } from './parse'
import { SurprisingFindingsView } from './SurprisingFindingsView'

export default async function SurprisingSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const md = report.markdown_content ?? ''

  // Extract the "What Surprised Us" section, strip its H2 line, then
  // split caption from findings so each can render in its own slot
  // of the page (subtitle vs. card grid).
  const section = splitMarkdownSections(md).find(
    (s) => s.heading.toLowerCase() === 'what surprised us',
  )
  const rawBody = section
    ? section.body.replace(/^##\s+What Surprised Us\s*\n?/i, '')
    : ''
  const cleanBody = stripTaskListCheckboxes(rawBody)
  const caption = extractSurprisingCaption(cleanBody)
  const findings = extractSurprisingFindings(cleanBody)

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="What Surprised Us"
      sectionSubtitle="Non-obvious findings detected algorithmically from the data. Flagged hypotheses, not verified conclusions."
      fullMarkdown={md}
    >
      <SurprisingFindingsView caption={caption} findings={findings} />
    </SectionShell>
  )
}
