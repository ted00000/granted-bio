import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { SectionShell } from '../SectionShell'
import { PatentsView } from './PatentsView'

interface AgentOutputs {
  patents?: {
    byAssignee?: Array<{ assignee: string; count: number }>
    recentCount?: number
  }
}

interface Patent {
  patent_id: string
  patent_title: string | null
  assignee: string | null
  patent_date: string | null
  inventors: string | null
}

// Overlay any patents-table fields that have been hydrated post-report-
// generation (see src/lib/patents/hydrator.ts). The report itself is a
// frozen JSONB snapshot — narrative sections stay tied to what the LLM
// wrote — but the interactive tables should reflect current enrichment
// where available so an already-hydrated patent doesn't render blank
// cells in an old report.
async function overlayHydratedFields(frozen: Patent[]): Promise<Patent[]> {
  if (frozen.length === 0) return frozen
  const supabase = await createServerSupabaseClient()
  const ids = frozen
    .map((p) => (p.patent_id || '').replace(/^US/i, '').replace(/[^0-9]/g, ''))
    .filter(Boolean)
  if (ids.length === 0) return frozen
  const { data } = await supabase
    .from('patents')
    .select('patent_id, inventors, issue_date, current_assignees, api_last_updated')
    .in('patent_id', ids)
  interface HydratedRow {
    patent_id: string
    inventors: string[] | null
    issue_date: string | null
    current_assignees: string[] | null
    api_last_updated: string | null
  }
  const rows = ((data as unknown) as HydratedRow[]) ?? []
  const byId = new Map<string, HydratedRow>()
  for (const r of rows) byId.set(r.patent_id, r)

  return frozen.map((p) => {
    const cleanId = (p.patent_id || '').replace(/^US/i, '').replace(/[^0-9]/g, '')
    const h = byId.get(cleanId)
    if (!h || !h.api_last_updated) return p
    const inventors = (h.inventors && h.inventors.length > 0)
      ? h.inventors.join(', ')
      : p.inventors
    const patent_date = h.issue_date || p.patent_date
    const assignee = (h.current_assignees && h.current_assignees.length > 0)
      ? h.current_assignees[0]
      : p.assignee
    return { ...p, inventors, patent_date, assignee }
  })
}

export default async function PatentsSectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  const frozen = (report.patents ?? []) as Patent[]
  const patents = await overlayHydratedFields(frozen)
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Patents"
      sectionSubtitle="USPTO patents linked to the projects in this analysis sample."
      fullMarkdown={report.markdown_content}
    >
      <PatentsView
        reportId={report.id}
        patents={patents}
        byAssignee={agentOutputs.patents?.byAssignee}
        recentCount={agentOutputs.patents?.recentCount}
      />
    </SectionShell>
  )
}
