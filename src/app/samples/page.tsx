// Public samples index — landing page for visitors who want to see
// what a granted.bio report looks like. Displays each sample as a card
// with real report stats pulled from the DB (project count, trial
// count, funding total). Adding a sample = one more entry in SAMPLES
// below plus a `/sample/<slug>` route.
//
// The "New" pill on radioligand is manually flagged for the LinkedIn
// launch (2026-08-07) and should be removed after ~4 weeks; the flag
// is a boolean per-entry rather than time-based so removal is one
// intentional commit rather than a silent decay.

import Link from 'next/link'
import { ArrowRight, FlaskConical, Activity, FileText, Sparkles } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase'
import { MarketingNav } from '@/components/MarketingNav'
import { GenerateReportCTA } from '@/components/GenerateReportCTA'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sample Intelligence Reports | granted.bio',
  description:
    'See real granted.bio intelligence reports. NIH funding, clinical trials, patents, and publications synthesized into strategic narrative. Two full samples on different topics — see what you get for $199 before you buy.',
}

interface Sample {
  slug: string
  title: string
  topic: string
  modality: string
  personaLabel: string
  description: string
  reportId: string
  isNew?: boolean
}

// Ordered display list. Radioligand is first + carries the "New" pill
// for the LinkedIn launch. Reorder or drop `isNew` when the launch
// window closes.
const SAMPLES: Sample[] = [
  {
    slug: 'radioligand-therapy',
    title: 'Radioligand Therapy for Cancer',
    topic: 'Radioligand therapy for cancer',
    modality: 'Therapeutics',
    personaLabel: 'Research persona',
    description:
      "One of oncology's fastest-growing modalities. Pluvicto-class radioligand therapies, PSMA/DOTATATE targeting, and the pipeline of alpha- and beta-emitter programs behind $6B+ of recent M&A.",
    reportId: '3b638569-8d3e-40c5-96a6-ca6c69c1d798',
    isNew: true,
  },
  {
    slug: 'liquid-biopsy',
    title: 'Liquid Biopsy for Early Cancer Detection',
    topic: 'Liquid biopsy for early cancer detection',
    modality: 'Diagnostics',
    personaLabel: 'Research persona',
    description:
      'Cell-free DNA methylation, ctDNA/CTC platforms, and adjacent circulating-biomarker approaches for pre-symptomatic cancer screening. Multi-cancer early detection is the anchor use case.',
    reportId: 'a4dbfb7b-2343-46a4-8763-35b1f16d8e58',
  },
]

interface ReportStats {
  projectCount: number | null
  trialCount: number
  fundingTotal: number
  createdAt: string
}

async function fetchStats(reportId: string): Promise<ReportStats | null> {
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('project_count, clinical_trials, funding_stats, created_at')
    .eq('id', reportId)
    .single()
  if (error || !data) {
    console.error(`[samples] failed to fetch stats for ${reportId}:`, error)
    return null
  }
  const trials = (data.clinical_trials ?? []) as unknown[]
  // funding_stats.total is the summed award amount across all projects
  // in the report — the field name mirrors what synthesizeReport emits
  // (see src/lib/reports/synthesize.ts). Not totalFunding.
  const fundingStats = (data.funding_stats ?? {}) as { total?: number }
  return {
    projectCount: data.project_count ?? null,
    trialCount: trials.length,
    fundingTotal: fundingStats.total ?? 0,
    createdAt: data.created_at,
  }
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export default async function SamplesIndexPage() {
  // Fetch stats for all samples in parallel. Nulls are tolerated —
  // the card renders "—" for missing values so a temporary DB blip
  // doesn't break the whole page.
  const stats = await Promise.all(SAMPLES.map((s) => fetchStats(s.reportId)))

  return (
    <div className="min-h-screen bg-[#FAFAF9] flex flex-col">
      <MarketingNav />

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 mb-3 px-3 py-1 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sample reports</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 mb-3">
            See what a granted.bio report looks like
          </h1>
          <p className="text-gray-500 max-w-2xl mx-auto">
            Two full samples on different topics — a therapeutic modality and a diagnostic modality. This is exactly what you get for $199 on any life-sciences research topic.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {SAMPLES.map((s, i) => {
            const st = stats[i]
            const Icon = s.modality === 'Therapeutics' ? Activity : FlaskConical
            return (
              <Link
                key={s.slug}
                href={`/sample/${s.slug}`}
                className="group relative bg-white rounded-xl border border-gray-200 p-6 hover:border-[#E07A5F] hover:shadow-lg transition-all"
              >
                {s.isNew && (
                  <span className="absolute top-4 right-4 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-[#E07A5F] text-white rounded">
                    New
                  </span>
                )}
                <div className="flex items-start gap-3 mb-4">
                  <div className="flex-shrink-0 p-2.5 bg-[#FDF2EF] rounded-lg">
                    <Icon className="w-5 h-5 text-[#E07A5F]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                      {s.modality} · {s.personaLabel}
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 group-hover:text-[#E07A5F] transition-colors">
                      {s.title}
                    </h2>
                  </div>
                </div>

                <p className="text-sm text-gray-600 leading-relaxed mb-5">
                  {s.description}
                </p>

                <div className="grid grid-cols-3 gap-3 mb-5 text-sm">
                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      {st?.projectCount?.toLocaleString() ?? '—'}
                    </div>
                    <div className="text-xs text-gray-500">projects</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      {st?.trialCount?.toLocaleString() ?? '—'}
                    </div>
                    <div className="text-xs text-gray-500">trials</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-gray-900">
                      {st ? formatMoney(st.fundingTotal) : '—'}
                    </div>
                    <div className="text-xs text-gray-500">NIH funding</div>
                  </div>
                </div>

                <div className="inline-flex items-center gap-1.5 text-sm font-medium text-[#E07A5F] group-hover:gap-2 transition-all">
                  View report
                  <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            )
          })}
        </div>

        <div className="mt-12 text-center bg-white border border-gray-200 rounded-xl p-8">
          <FileText className="w-8 h-8 text-[#E07A5F] mx-auto mb-3" strokeWidth={1.5} />
          <h2 className="text-xl md:text-2xl font-semibold text-gray-900 mb-2">
            Generate one on your own topic
          </h2>
          <p className="text-gray-500 mb-6 max-w-xl mx-auto">
            Any life-sciences research topic. $199, generated in two minutes.
          </p>
          <GenerateReportCTA className="inline-flex items-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors">
            Generate a Report
            <ArrowRight className="w-4 h-4" />
          </GenerateReportCTA>
        </div>
      </main>

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
