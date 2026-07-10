// Public sample page — renders a real, fully-generated intelligence
// report so logged-out visitors can see what they get for $199 before
// committing. The report id is hardcoded; swapping the sample later is
// a one-line change. Fetched server-side via the admin client so the
// row's RLS policies (which restrict reads to the owning user) don't
// block public visibility.
//
// Phase 4 minimum scope (per LANDING_AND_CREDITS_PLAN.md): the markdown
// renders, but internal links (project, trial, patent, publication
// detail pages) route through the existing auth flow. The soft-gate
// drill-down promised in the wireframe will ship in a follow-up.

import Link from 'next/link'
import { Sparkles, ArrowRight, FileText } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase'
import { MarketingNav } from '@/components/MarketingNav'
import { GenerateReportCTA } from '@/components/GenerateReportCTA'
import { MarkdownRenderer } from '../../reports/[id]/MarkdownRenderer'

const SAMPLE_REPORT_ID = '10d8b6ea-4806-448e-95ba-ca1b0e429101'

// Force dynamic rendering — every request pulls the current row from the
// DB. Was ISR (revalidate = 60), but that caused a real problem: when
// SAMPLE_REPORT_ID gets swapped to a fresh report, the CDN edge cache
// can serve the previous render for up to a minute per edge region,
// which is confusing when we're validating changes with a reviewer.
// The sample page is low-traffic marketing — one DB read per visit is
// negligible, and eliminating the "which build am I looking at?" class
// of question is worth more than the caching savings.
//
// r25 audit exposed this pattern: reviewer's anonymous fetches kept
// hitting a pre-swap edge cache while our authenticated view + Vercel
// deploy ID reported the new build was live.
export const dynamic = 'force-dynamic'

export const metadata = {
  title:
    'Sample Intelligence Report — Liquid Biopsy for Early Cancer Detection | granted.bio',
  description:
    'See exactly what a granted.bio intelligence report contains. NIH funding, clinical trials, patents, and publications synthesized into strategic narrative on the liquid biopsy field. Generated in two minutes.',
}

interface FundingByYear {
  year: number
  funding: number
  projects: number
  isPartial?: boolean
}
interface CategoryData {
  category: string
  projects: number
  funding: number
}
interface FundingStats {
  byYear?: FundingByYear[]
  byCategory?: CategoryData[]
}
interface AgentOutputs {
  trials?: { byPhase?: Record<string, number> }
}

async function fetchSampleReport() {
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select(
      'id, title, topic, status, markdown_content, funding_stats, agent_outputs, project_count, created_at'
    )
    .eq('id', SAMPLE_REPORT_ID)
    .single()

  if (error || !data) {
    console.error('[sample] Failed to load sample report:', error)
    return null
  }
  return data
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  // UTC format to match the markdown "Generated:" line — see
  // src/app/reports/[id]/page.tsx for the fuller explanation.
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default async function SampleLiquidBiopsyPage() {
  const report = await fetchSampleReport()

  if (!report || !report.markdown_content) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <MarketingNav />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center">
          <p className="text-gray-600">
            Sample report is temporarily unavailable. Please try again in a moment.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-[#E07A5F] hover:text-[#C96A4F] font-medium"
          >
            Back to home
          </Link>
        </main>
      </div>
    )
  }

  const fundingStats = (report.funding_stats ?? {}) as FundingStats
  const agentOutputs = (report.agent_outputs ?? {}) as AgentOutputs

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      {/* Sample banner — sticky-ish framing so visitors always know
          this is the artifact, and there's a clear path to "get one
          on my topic." */}
      <div className="bg-[#E07A5F]/10 border-b border-[#E07A5F]/20">
        <div className="max-w-4xl mx-auto px-6 py-3 flex flex-col sm:flex-row items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-[#E07A5F] flex-shrink-0" />
            <span className="text-gray-700">
              <span className="font-medium">Sample report.</span> This is the
              intelligence we generate for any life-sciences research topic.
            </span>
          </div>
          <GenerateReportCTA
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E07A5F] hover:bg-[#C96A4F] text-white text-xs font-medium rounded-md transition-colors whitespace-nowrap"
          >
            Generate on your topic — $199
            <ArrowRight className="w-3.5 h-3.5" />
          </GenerateReportCTA>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {/* Report header — same layout as the authenticated detail page so
            the sample feels identical to what a buyer would see. */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-[#FDF2EF] rounded-lg">
              <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 mb-1">
                {report.title}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>Generated {formatDate(report.created_at)}</span>
                {report.project_count !== null && (
                  <>
                    <span>•</span>
                    <span>{report.project_count} projects analyzed</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* The actual report content */}
        <div id="report-content" className="bg-white rounded-lg shadow-sm">
          <MarkdownRenderer
            content={report.markdown_content}
            chartData={{
              fundingByYear: fundingStats.byYear,
              categories: fundingStats.byCategory,
              trialsByPhase: agentOutputs.trials?.byPhase,
              // whiteSpace lives on agent_outputs.whiteSpace (added by the
              // synthesis step); typed loosely here since agent_outputs is
              // an opaque JSONB blob at fetch time.
              whiteSpace: (agentOutputs as { whiteSpace?: unknown })?.whiteSpace as never,
            }}
          />
        </div>
      </main>

      {/* Trailing CTA — last impression before the visitor leaves. */}
      <section className="py-16 px-6 bg-gradient-to-br from-[#E07A5F] to-[#C96A4F]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">
            Get this on your topic.
          </h2>
          <p className="text-white/85 mb-2">
            Synthesizing NIH funding, clinical trials, patents, and publications
            into insights no single source can produce.
          </p>
          <p className="text-white text-lg font-semibold mb-8">
            $199, generated in two minutes.
          </p>
          <GenerateReportCTA
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#E07A5F] rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            Generate a Report
            <ArrowRight className="w-4 h-4" />
          </GenerateReportCTA>
        </div>
      </section>

      {/* Same footer as marketing pages */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data from NIH RePORTER, ClinicalTrials.gov, USPTO &amp; PubMed
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a
              href="mailto:hello@granted.bio"
              className="hover:text-gray-600 transition-colors"
            >
              Contact
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
