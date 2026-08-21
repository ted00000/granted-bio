import { notFound } from 'next/navigation'
import { getReport } from '@/lib/reports/fetch-report'
import { SectionShell } from '../SectionShell'
import { MarketContextView } from './MarketContextView'

export default async function MarketContextPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await getReport(id)
  if (!report) notFound()

  // Market context lives on its own column (market_context, enriched
  // by the synthesis step). agent_outputs.market.context has the same
  // shape but the top-level column is authoritative post-synthesis.
  const market = (report.market_context ?? null) as
    | React.ComponentProps<typeof MarketContextView>['market']
    | null

  return (
    <SectionShell
      reportId={report.id}
      reportTopic={report.topic}
      reportTitle={report.title}
      sectionLabel="Market Context"
      sectionSubtitle="Commercial framing pulled from web sources — competitors, market sizing, deal flow."
      fullMarkdown={report.markdown_content}
    >
      <MarketContextView market={market} />
    </SectionShell>
  )
}
