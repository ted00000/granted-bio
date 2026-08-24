/**
 * Print-optimized route for a generated report.
 *
 * As of 2026-08-24 this renders a short executive-summary shape
 * rather than the full report markdown. Rationale:
 *   * The interactive portal at /reports/[id] (and its shared
 *     variant at /share/[token]) is now the primary deliverable —
 *     drill-down links, live counts, section navigation.
 *   * A 50-page PDF full of dead links reads as "the deliverable"
 *     when it's really a snapshot. Trim to 3–5 pages of teaser and
 *     point the reader back to the live portal.
 *
 * Layout (post-cover):
 *   1. Cover page (branded, title, generated date)
 *   2. Executive summary — the report.executive_summary text with
 *      the title as H1. 1–2 pages typical.
 *   3. At-a-glance metrics — six tiles (projects, funding, trials,
 *      patents, publications, orgs) plus the funding-by-year chart
 *      when available.
 *   4. Full-analysis back-link — the share URL passed via
 *      ?shareUrl= query param, prominently displayed with a
 *      "no login required" clarification.
 *
 * The share URL is minted server-side by /api/reports/[id]/pdf
 * before Puppeteer navigates here; if the query param is absent
 * (e.g., someone opens /print directly for design review) we fall
 * back to a portal URL and omit the CTA copy that assumes shareable
 * access.
 */

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { PrintShell } from './PrintShell'
import fs from 'fs'
import path from 'path'

const PRINT_CSS = fs.readFileSync(
  path.join(process.cwd(), 'src/app/reports/[id]/print/print.css'),
  'utf-8',
)

export const dynamic = 'force-dynamic'

interface PrintPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ shareUrl?: string }>
}

interface FundingStats {
  total?: number
  projectCount?: number
  orgCount?: number
  piCount?: number
  byYear?: Array<{ year: number; funding: number; projects: number; isPartial?: boolean }>
}

interface ReportRow {
  id: string
  title: string | null
  topic: string
  persona: string | null
  executive_summary: string | null
  markdown_content: string | null
  created_at: string
  project_count: number | null
  funding_stats: FundingStats | null
  clinical_trials: unknown[] | null
  patents: unknown[] | null
  publications: unknown[] | null
  top_organizations: Array<{ org: string; funding?: number; projects?: number }> | null
  agent_outputs: {
    trials?: { byPhase?: Record<string, number> }
  } | null
}

function formatMoney(n: number): string {
  if (!n) return '$0'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function paragraphize(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export default async function ReportPrintPage({ params, searchParams }: PrintPageProps) {
  const { id } = await params
  const { shareUrl } = await searchParams

  const { data } = await supabaseAdmin
    .from('user_reports')
    .select(
      'id, title, topic, persona, executive_summary, markdown_content, created_at, project_count, funding_stats, clinical_trials, patents, publications, top_organizations, agent_outputs',
    )
    .eq('id', id)
    .single<ReportRow>()

  if (!data) {
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

  const fs2 = data.funding_stats ?? {}
  const stats = {
    projects: fs2.projectCount ?? data.project_count ?? 0,
    funding: fs2.total ?? 0,
    trials: (data.clinical_trials ?? []).length,
    patents: (data.patents ?? []).length,
    publications: (data.publications ?? []).length,
    organizations: fs2.orgCount ?? (data.top_organizations ?? []).length,
  }

  const executiveSummaryParagraphs = data.executive_summary
    ? paragraphize(data.executive_summary)
    : []

  const topOrgs = (data.top_organizations ?? []).slice(0, 5)

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
          <p className="subtitle" style={{ marginTop: '0.25in', fontStyle: 'italic', color: '#888' }}>
            Executive summary — see the interactive analysis online for full detail.
          </p>
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

      {/* Body pages. All wrapped in .print-body so the print stylesheet's
          typography rules apply consistently. PrintShell handles the
          window.__printReady signal that Puppeteer waits on. */}
      <PrintShell content="" chartData={{}}>
        <div className="print-summary">
          {/* Executive summary */}
          <section className="print-page">
            <h1 className="print-h1">Executive Summary</h1>
            {executiveSummaryParagraphs.length > 0 ? (
              executiveSummaryParagraphs.map((p, i) => (
                <p key={i} className="print-p">
                  {p}
                </p>
              ))
            ) : (
              <p className="print-p" style={{ fontStyle: 'italic', color: '#888' }}>
                No executive summary is stored for this report. See the interactive analysis online for the full narrative.
              </p>
            )}
          </section>

          {/* At-a-glance metrics */}
          <section className="print-page print-page-break">
            <h2 className="print-h2">At a Glance</h2>
            <p className="print-p print-caption">
              Data drawn from the full analyzed sample. Every count is
              drillable in the interactive analysis.
            </p>

            <div className="print-metric-grid">
              <MetricTile label="Projects" value={stats.projects.toLocaleString()} />
              <MetricTile label="NIH Funding" value={formatMoney(stats.funding)} />
              <MetricTile label="Clinical Trials" value={stats.trials.toLocaleString()} />
              <MetricTile label="Patents" value={stats.patents.toLocaleString()} />
              <MetricTile label="Publications" value={stats.publications.toLocaleString()} />
              <MetricTile label="Organizations" value={stats.organizations.toLocaleString()} />
            </div>

            {topOrgs.length > 0 && (
              <>
                <h3 className="print-h3" style={{ marginTop: '0.35in' }}>
                  Top-Funded Organizations
                </h3>
                <table className="print-table">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th style={{ textAlign: 'right' }}>Projects</th>
                      <th style={{ textAlign: 'right' }}>Funding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topOrgs.map((o, i) => (
                      <tr key={i}>
                        <td>{o.org}</td>
                        <td style={{ textAlign: 'right' }}>
                          {(o.projects ?? 0).toLocaleString()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {formatMoney(o.funding ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {/* Back-link to full analysis */}
          <section className="print-page print-page-break print-cta">
            <div className="accent-bar" />
            <h2 className="print-h2">See the Full Analysis</h2>
            <p className="print-p print-lead">
              This document is a summary. The full analysis includes
              funding landscape, competitive topology, white-space
              opportunities, market context, every linked project,
              trial, patent, and publication, and an interactive
              drill-down for each.
            </p>
            {shareUrl ? (
              <>
                <p className="print-p" style={{ marginTop: '0.4in' }}>
                  Visit the link below to view the interactive analysis
                  online. No account is required.
                </p>
                <div className="print-share-url">{shareUrl}</div>
                <p className="print-p print-caption">
                  Link expires 60 days after generation. If it stops
                  working, ask the sender to send a new one.
                </p>
              </>
            ) : (
              <>
                <p className="print-p" style={{ marginTop: '0.4in' }}>
                  Sign in to your granted.bio account to view the full
                  interactive analysis.
                </p>
                <div className="print-share-url">https://www.granted.bio/reports/{id}</div>
              </>
            )}
          </section>
        </div>
      </PrintShell>
    </>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="print-metric-tile">
      <div className="print-metric-label">{label}</div>
      <div className="print-metric-value">{value}</div>
    </div>
  )
}
