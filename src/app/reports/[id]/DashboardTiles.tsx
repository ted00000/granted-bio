'use client'

// Dashboard metric tiles — the at-a-glance "how big is this space"
// view a first-time reader sees. Six tiles in a responsive grid: one
// per data dimension (projects/trials/patents/pubs/orgs/researchers),
// with a secondary line surfacing the single most meaningful signal
// for that dimension.
//
// Deliberately static counts, not interactive. Interactive drill-in
// happens by clicking the corresponding sidebar nav entry. The
// dashboard is a launchpad, not a data browser.

import { FlaskConical, Activity, Award, BookOpen, Building2, Users } from 'lucide-react'
import Link from 'next/link'
import { useReportView } from './ReportViewContext'

interface FundingByYear {
  year: number
  funding: number
  projects: number
  isPartial?: boolean
}

interface DashboardTilesProps {
  reportId: string
  projectCount: number
  fundingTotal: number
  fundingByYear: FundingByYear[]
  trialsCount: number
  trialsByPhase?: Record<string, number>
  patentsCount: number
  publicationsCount: number
  organizationsCount: number
  researchersCount: number
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function computeYoYDelta(byYear: FundingByYear[]): string | null {
  if (!byYear || byYear.length < 2) return null
  // byYear may be sorted asc or desc; find current + prior FY by year value.
  const sorted = [...byYear].sort((a, b) => b.year - a.year)
  // Skip partial FY when computing YoY — an in-progress fiscal year's
  // total is not comparable to a complete prior year.
  const complete = sorted.filter((y) => !y.isPartial)
  if (complete.length < 2) return null
  const [curr, prev] = complete
  if (!curr.funding || !prev.funding) return null
  const delta = ((curr.funding - prev.funding) / prev.funding) * 100
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(0)}% FY${String(curr.year).slice(-2)} vs FY${String(prev.year).slice(-2)}`
}

function topPhase(byPhase?: Record<string, number>): string | null {
  if (!byPhase) return null
  const entries = Object.entries(byPhase).filter(([, n]) => n > 0)
  if (entries.length === 0) return null
  entries.sort((a, b) => b[1] - a[1])
  const [phase, n] = entries[0]
  return `${n} in ${phase}`
}

export function DashboardTiles({
  projectCount,
  fundingTotal,
  fundingByYear,
  trialsCount,
  trialsByPhase,
  patentsCount,
  publicationsCount,
  organizationsCount,
  researchersCount,
}: DashboardTilesProps) {
  // reportId prop is kept in the interface for callsite compatibility
  // but the actual URL prefix now comes from context so share-view
  // tile clicks stay under /share/[token] instead of leaking back to
  // /reports/[id] (which the recipient can't access).
  const { basePath } = useReportView()
  const yoy = computeYoYDelta(fundingByYear)
  const topPhaseLabel = topPhase(trialsByPhase)

  const tiles: Array<{
    label: string
    href: string
    primary: string
    secondary: string | null
    icon: typeof FlaskConical
  }> = [
    {
      label: 'Projects',
      href: `${basePath}/projects`,
      primary: projectCount.toLocaleString(),
      secondary: fundingTotal > 0 ? `${formatMoney(fundingTotal)} NIH funding` : null,
      icon: FlaskConical,
    },
    {
      label: 'Clinical Trials',
      href: `${basePath}/trials`,
      primary: trialsCount.toLocaleString(),
      secondary: topPhaseLabel,
      icon: Activity,
    },
    {
      label: 'Patents',
      href: `${basePath}/patents`,
      primary: patentsCount.toLocaleString(),
      secondary: patentsCount === 0 ? 'none linked in sample' : null,
      icon: Award,
    },
    {
      label: 'Publications',
      href: `${basePath}/publications`,
      primary: publicationsCount.toLocaleString(),
      secondary: null,
      icon: BookOpen,
    },
    {
      label: 'Organizations',
      href: `${basePath}/organizations`,
      primary: organizationsCount.toLocaleString(),
      secondary: null,
      icon: Building2,
    },
    {
      label: 'Researchers',
      href: `${basePath}/researchers`,
      primary: researchersCount.toLocaleString(),
      secondary: null,
      icon: Users,
    },
  ]

  return (
    <div>
      {yoy && (
        <div className="mb-3 text-xs text-gray-500">
          <span className="font-medium text-gray-700">Funding trend:</span> {yoy}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon
          return (
            <Link
              key={t.label}
              href={t.href}
              className="group bg-white rounded-lg border border-gray-200 p-4 hover:border-[#E07A5F] hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-[#FDF2EF] rounded-md flex-shrink-0">
                  <Icon className="w-4 h-4 text-[#E07A5F]" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-2xl font-semibold text-gray-900 group-hover:text-[#E07A5F] transition-colors tabular-nums">
                    {t.primary}
                  </div>
                  <div className="text-xs font-medium text-gray-700 mt-0.5">{t.label}</div>
                  {t.secondary && (
                    <div className="text-[11px] text-gray-500 mt-1 truncate">{t.secondary}</div>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
