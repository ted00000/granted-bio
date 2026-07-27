/**
 * Print-optimized route for a generated report.
 *
 * Renders the same MarkdownRenderer + charts used by the web view, but
 * wrapped in a print stylesheet (`./print.css`) with CSS Paged Media
 * rules. Chromium headless loads this route via Puppeteer to generate
 * the final PDF; the same URL is also viewable in a normal browser as
 * a design preview (Cmd+P for print preview).
 *
 * The route is server-rendered so Puppeteer sees complete HTML on
 * first paint. A small client shell (`./PrintShell`) fires
 * `window.__printReady` after Recharts finishes drawing SVGs — that's
 * the signal the Puppeteer step waits on before calling page.pdf().
 *
 * We deliberately do NOT emit our own <html>/<body> — the root layout
 * (src/app/layout.tsx) already does that, and duplicating it breaks
 * hydration (charts stopped rendering in the first cut). The nested
 * `./layout.tsx` in this same folder swaps the app chrome (nav, auth
 * shell) out so print output stays clean.
 */

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { PrintShell } from './PrintShell'
import fs from 'fs'
import path from 'path'

// Loaded server-side and inlined into <style> so Puppeteer doesn't
// need to fetch a stylesheet asset separately.
const PRINT_CSS = fs.readFileSync(
  path.join(process.cwd(), 'src/app/reports/[id]/print/print.css'),
  'utf-8',
)

export const dynamic = 'force-dynamic'

interface PrintPageProps {
  params: Promise<{ id: string }>
}

interface FundingByYearRow {
  year: number
  funding: number
  projects: number
}
interface CategoryRow {
  category: string
  projects: number
  funding: number
}
interface ReportRow {
  id: string
  title: string | null
  topic: string
  persona: string | null
  markdown_content: string | null
  created_at: string
  funding_stats: {
    byYear?: FundingByYearRow[]
    byCategory?: CategoryRow[]
  } | null
  agent_outputs: {
    trials?: { byPhase?: Record<string, number> }
    whiteSpace?: unknown
  } | null
}

export default async function ReportPrintPage({ params }: PrintPageProps) {
  const { id } = await params

  const { data } = await supabaseAdmin
    .from('user_reports')
    .select('id, title, topic, persona, markdown_content, created_at, funding_stats, agent_outputs')
    .eq('id', id)
    .single<ReportRow>()

  if (!data || !data.markdown_content) {
    notFound()
  }

  const title = (data.title || data.topic || 'Intelligence Report').trim()
  const subtitle = data.persona === 'investor'
    ? 'Investor Intelligence Report'
    : 'Research Intelligence Report'
  const generatedDate = new Date(data.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const currentYear = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    timeZone: 'UTC',
  })

  const chartData = {
    fundingByYear: data.funding_stats?.byYear,
    categories: data.funding_stats?.byCategory,
    trialsByPhase: data.agent_outputs?.trials?.byPhase,
    whiteSpace: data.agent_outputs?.whiteSpace,
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* Running header + footer — the @page rules pull these into
          every printed page via `position: running(...)`. Kept as
          siblings of the flow content so they're invisible on screen. */}
      <div className="running-header">
        <span className="brand">granted.<span className="dot">bio</span></span>
        <span>{title}</span>
      </div>
      <div className="running-footer-left">© {currentYear} granted.bio</div>
      <div className="running-footer-right">{generatedDate}</div>

      {/* Cover page. @page :first strips the running header/footer
          so the cover has clean bleed-to-margin whitespace. */}
      <section className="print-cover">
        <div>
          <div className="brand-mark">
            granted<span className="dot">.bio</span>
          </div>
          <div className="accent-bar" style={{ marginTop: '0.5in' }} />
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="meta">
          <div className="row">
            <span>Generated</span>
            <span>{generatedDate}</span>
          </div>
          <div className="row">
            <span>Report ID</span>
            <span style={{ fontFamily: 'monospace' }}>{data.id.slice(0, 8)}</span>
          </div>
          <div className="row">
            <span>Persona</span>
            <span style={{ textTransform: 'capitalize' }}>
              {data.persona || 'researcher'}
            </span>
          </div>
        </div>
      </section>

      {/* Report body — same MarkdownRenderer used by the web view. */}
      <PrintShell content={data.markdown_content} chartData={chartData} />
    </>
  )
}
