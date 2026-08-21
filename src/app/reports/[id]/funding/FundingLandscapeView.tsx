// Bespoke render for the Funding Landscape Analysis page. Uses the
// structured funding_stats column (see types.ts FundingStats) plus
// the narrative markdown extracted from `## NIH Funding Landscape`
// (researcher) / `## NIH Funding Analysis` (investor).
//
// Content:
//   - Metric tile row: total funding, projects, orgs, PIs, YoY delta
//   - Funding by year chart (existing chart component)
//   - Category distribution table
//   - Top organizations by funding table
//   - Narrative (with confidence chips auto-extracted)

import { MarkdownRenderer } from '../MarkdownRenderer'
import { FundingByYearChart, CategoryDistributionChart } from '../charts'
import { DollarSign, Building2, Users, FlaskConical } from 'lucide-react'

interface FundingByYear {
  year: number
  projects: number
  funding: number
  isPartial?: boolean
}

interface CategoryRow {
  category: string
  projects: number
  funding: number
}

interface OrgRow {
  org: string
  projects: number
  funding: number
}

interface FundingStats {
  total: number
  projectCount: number
  orgCount: number
  piCount: number
  byYear: FundingByYear[]
  byCategory: CategoryRow[]
  byOrg: OrgRow[]
  currentFY?: number
  partialFYNote?: string
}

interface FundingLandscapeViewProps {
  fundingStats: FundingStats | null
  narrative: string
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

function computeYoY(byYear: FundingByYear[]): string | null {
  if (byYear.length < 2) return null
  const complete = [...byYear].filter((y) => !y.isPartial).sort((a, b) => b.year - a.year)
  if (complete.length < 2) return null
  const [curr, prev] = complete
  if (!curr.funding || !prev.funding) return null
  const delta = ((curr.funding - prev.funding) / prev.funding) * 100
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(0)}% FY${String(curr.year).slice(-2)}`
}

export function FundingLandscapeView({ fundingStats, narrative }: FundingLandscapeViewProps) {
  if (!fundingStats) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <DollarSign className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Funding statistics were not computed for this analysis.
        </p>
      </div>
    )
  }

  const yoy = computeYoY(fundingStats.byYear)

  const tiles: Array<{ icon: typeof DollarSign; label: string; primary: string; secondary?: string }> = [
    {
      icon: DollarSign,
      label: 'Total NIH funding',
      primary: formatMoney(fundingStats.total),
      secondary: yoy ? `${yoy} vs prior` : undefined,
    },
    {
      icon: FlaskConical,
      label: 'Projects',
      primary: fundingStats.projectCount.toLocaleString(),
    },
    {
      icon: Building2,
      label: 'Organizations',
      primary: fundingStats.orgCount.toLocaleString(),
    },
    {
      icon: Users,
      label: 'Principal Investigators',
      primary: fundingStats.piCount.toLocaleString(),
    },
  ]

  return (
    <div className="space-y-5">
      {/* Metric tiles — 4 across on desktop, 2x2 on mobile */}
      <section>
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
          Sample scope
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((t) => {
            const Icon = t.icon
            return (
              <div
                key={t.label}
                className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-4"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {t.label}
                </div>
                <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
                  {t.primary}
                </div>
                {t.secondary && (
                  <div className="text-[11px] text-gray-500 mt-1">{t.secondary}</div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Funding by year chart — reuses existing chart component */}
      {fundingStats.byYear.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Funding by fiscal year
          </div>
          <FundingByYearChart data={fundingStats.byYear} />
          {fundingStats.partialFYNote && (
            <p className="text-[11px] text-gray-500 mt-3 italic">
              {fundingStats.partialFYNote}
            </p>
          )}
        </section>
      )}

      {/* Category distribution — chart + table side by side on desktop */}
      {fundingStats.byCategory.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Funding by category
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div className="md:col-span-2">
              <CategoryDistributionChart data={fundingStats.byCategory} />
            </div>
            <div className="md:col-span-3">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-2 pr-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="pb-2 px-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      Projects
                    </th>
                    <th className="pb-2 px-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      Share
                    </th>
                    <th className="pb-2 pl-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                      Funding
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fundingStats.byCategory.slice(0, 8).map((row) => {
                    const share = ((row.projects / Math.max(fundingStats.projectCount, 1)) * 100).toFixed(1)
                    return (
                      <tr key={row.category} className="border-b border-gray-100 last:border-b-0">
                        <td className="py-2 pr-2 text-[14px] text-gray-900">
                          {formatCategory(row.category)}
                        </td>
                        <td className="py-2 px-2 text-[14px] text-gray-700 tabular-nums text-right">
                          {row.projects}
                        </td>
                        <td className="py-2 px-2 text-[13px] text-gray-500 tabular-nums text-right">
                          {share}%
                        </td>
                        <td className="py-2 pl-2 text-[14px] text-gray-900 tabular-nums font-medium text-right">
                          {formatMoney(row.funding)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Top orgs by funding */}
      {fundingStats.byOrg.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Top-funded organizations
          </div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 pr-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Organization
                </th>
                <th className="pb-2 px-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Projects
                </th>
                <th className="pb-2 pl-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Funding
                </th>
              </tr>
            </thead>
            <tbody>
              {fundingStats.byOrg.slice(0, 10).map((row) => (
                <tr key={row.org} className="border-b border-gray-100 last:border-b-0">
                  <td className="py-2 pr-2 text-[14px] text-gray-900">{row.org}</td>
                  <td className="py-2 px-2 text-[14px] text-gray-700 tabular-nums text-right">
                    {row.projects}
                  </td>
                  <td className="py-2 pl-2 text-[14px] text-gray-900 tabular-nums font-medium text-right">
                    {formatMoney(row.funding)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Narrative — Claude's synthesis. Confidence chips + evidence
          panels light up automatically inside MarkdownRenderer. */}
      {narrative && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Analysis
          </div>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={narrative} compact />
          </div>
        </section>
      )}
    </div>
  )
}
