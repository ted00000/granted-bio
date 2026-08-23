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

import Link from 'next/link'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { SectionLabel } from '../SectionLabel'
import { InternalLink } from '../EntityLink'
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

interface ProjectRow {
  application_id: string
  title: string
  org_name: string | null
  total_cost: number | null
}

interface FundingLandscapeViewProps {
  reportId: string
  fundingStats: FundingStats | null
  /** Full project sample from agent_outputs.projects.items — used to
   *  show which specific projects make up each top-funded org's total
   *  instead of just an abstract count. */
  allProjects: ProjectRow[]
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

export function FundingLandscapeView({ reportId, fundingStats, allProjects, narrative }: FundingLandscapeViewProps) {
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

  // Tile config. `href` is optional — when present, the tile renders
  // as a clickable link to the corresponding Data page. Total NIH
  // Funding has no natural drill-in, so it stays a plain card.
  const tiles: Array<{
    icon: typeof DollarSign
    label: string
    primary: string
    secondary?: string
    href?: string
  }> = [
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
      href: `/reports/${reportId}/projects`,
    },
    {
      icon: Building2,
      label: 'Organizations',
      primary: fundingStats.orgCount.toLocaleString(),
      href: `/reports/${reportId}/organizations`,
    },
    {
      icon: Users,
      label: 'Principal Investigators',
      primary: fundingStats.piCount.toLocaleString(),
      href: `/reports/${reportId}/researchers`,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Metric tiles — 4 across on desktop, 2x2 on mobile */}
      <section>
        <SectionLabel className="mb-3 px-1">Sample Scope</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((t) => {
            const Icon = t.icon
            const inner = (
              <>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {t.label}
                </div>
                <div className={`text-xl font-semibold tabular-nums leading-tight ${t.href ? 'text-gray-900 group-hover:text-[#E07A5F] transition-colors' : 'text-gray-900'}`}>
                  {t.primary}
                </div>
                {t.secondary && (
                  <div className="text-[11px] text-gray-500 mt-1">{t.secondary}</div>
                )}
              </>
            )
            const baseClass = 'bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-4'
            const linkClass = `${baseClass} block group hover:border-[#E07A5F] hover:shadow transition-all`
            return t.href ? (
              <Link key={t.label} href={t.href} className={linkClass}>
                {inner}
              </Link>
            ) : (
              <div key={t.label} className={baseClass}>
                {inner}
              </div>
            )
          })}
        </div>
      </section>

      {/* Funding by year chart — reuses existing chart component */}
      {fundingStats.byYear.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel className="mb-4">Funding by Fiscal Year</SectionLabel>
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
          <SectionLabel className="mb-4">Funding by Category</SectionLabel>
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

      {/* Top-funded organizations — each org expanded to show the
          actual projects making up its funding total. Org name links
          to /org/[name] for cross-source detail; each project links
          to /project/[id]. Reader sees WHAT the org is funded for,
          not just an abstract project count. Cap per-org at 5 with
          "+N more" to keep the list scannable when a single org
          holds many projects. */}
      {fundingStats.byOrg.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel className="mb-4">Top-Funded Organizations</SectionLabel>
          <div className="divide-y divide-gray-100">
            {fundingStats.byOrg.slice(0, 10).map((row) => {
              const orgProjects = allProjects
                .filter((p) => p.org_name === row.org)
                .sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0))
              const shownProjects = orgProjects.slice(0, 5)
              const moreCount = orgProjects.length - shownProjects.length
              return (
                <div key={row.org} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <InternalLink
                      href={`/org/${encodeURIComponent(row.org)}`}
                      className="text-[14px] font-medium text-gray-900 leading-snug"
                    >
                      {row.org}
                    </InternalLink>
                    <div className="flex-shrink-0 flex items-baseline gap-3 text-[13px] text-gray-500 tabular-nums">
                      <span>
                        {row.projects} {row.projects === 1 ? 'project' : 'projects'}
                      </span>
                      <span className="text-gray-900 font-medium text-[14px]">
                        {formatMoney(row.funding)}
                      </span>
                    </div>
                  </div>
                  {shownProjects.length > 0 && (
                    <ul className="space-y-1 pl-3 border-l border-gray-100">
                      {shownProjects.map((p) => (
                        <li key={p.application_id} className="text-[13px] leading-snug text-gray-600">
                          <InternalLink
                            href={`/project/${p.application_id}`}
                            className="text-gray-600"
                          >
                            {p.title}
                          </InternalLink>
                        </li>
                      ))}
                      {moreCount > 0 && (
                        <li className="text-[12px] text-gray-400 italic">
                          +{moreCount} more {moreCount === 1 ? 'project' : 'projects'}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Narrative — Claude's synthesis. Confidence chips + evidence
          panels light up automatically inside MarkdownRenderer. */}
      {narrative && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Analysis</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={narrative} compact />
          </div>
        </section>
      )}
    </div>
  )
}
