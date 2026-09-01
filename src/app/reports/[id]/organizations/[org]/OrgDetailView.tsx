// Analysis-scoped org detail view — lists ALL projects attributed to
// one organization within this specific analysis sample. Distinct
// from /org/[name] which shows unscoped cross-source data for the
// same org across the entire platform.
//
// Design decisions:
//   - Sample-scope tile row up top (project count + funding within
//     this analysis), same visual system as Funding Landscape.
//   - Full project list — no top-N truncation. If an org has 30
//     projects in this sample, all 30 render. Scope is already
//     narrowed to one org, so showing everything is appropriate.
//   - Prominent "See {Org}'s full profile across the platform" link
//     to /org/[name] for the unscoped view. Positioned as a
//     dedicated callout, not buried inline.

import Link from 'next/link'
import { ArrowRight, Building2 } from 'lucide-react'
import { SectionLabel } from '../../SectionLabel'
import { DataTable, type Column } from '../../DataTable'
import { InternalLink } from '../../EntityLink'
import { getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { detailHref } from '@/lib/reports/share-nav'

interface Project {
  application_id: string
  project_number: string | null
  title: string
  pi_names: string | null
  total_cost: number | null
  primary_category: string | null
}

interface OrgDetailViewProps {
  orgName: string
  projects: Project[]
  totalFunding: number
}

function formatMoney(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function formatCategory(cat: string | null): string {
  if (!cat) return '—'
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

function firstPI(names: string | null): string {
  if (!names) return '—'
  return names.split(';')[0]?.trim() || '—'
}

export async function OrgDetailView({ orgName, projects, totalFunding }: OrgDetailViewProps) {
  const inShare = !!(await getShareContextFromHeaders())
  const columns: Column<Project>[] = [
    {
      label: 'Project',
      widthClass: 'w-1/2',
      render: (p) => (
        <div>
          <InternalLink
            href={detailHref(`/project/${p.application_id}`, inShare)}
            className="text-gray-900 font-medium leading-snug block mb-0.5"
          >
            {p.title}
          </InternalLink>
          {p.project_number && (
            <div className="text-[11px] text-gray-400 tabular-nums">{p.project_number}</div>
          )}
        </div>
      ),
    },
    {
      label: 'PI',
      render: (p) => {
        const name = firstPI(p.pi_names)
        if (name === '—') return <span className="text-gray-400">—</span>
        return (
          <InternalLink href={detailHref(`/researcher/${encodeURIComponent(name)}`, inShare)} className="text-gray-700">
            {name}
          </InternalLink>
        )
      },
    },
    {
      label: 'Category',
      render: (p) => (
        <span className="text-gray-600 text-[13px]">{formatCategory(p.primary_category)}</span>
      ),
    },
    {
      label: 'Funding',
      align: 'right',
      cellClass: 'tabular-nums font-medium text-gray-900',
      render: (p) => formatMoney(p.total_cost),
    },
  ]

  return (
    <div className="space-y-5">
      {/* Sample-scope tiles for this org within this analysis */}
      <section>
        <SectionLabel className="mb-3 px-1">In This Analysis</SectionLabel>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-4">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Projects
            </div>
            <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
              {projects.length.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-4">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              NIH Funding
            </div>
            <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
              {formatMoney(totalFunding)}
            </div>
          </div>
        </div>
      </section>

      {/* Full project list for this org within the analysis sample */}
      <div className="space-y-4">
        <SectionLabel className="mb-0 px-1" count={projects.length}>
          Projects
        </SectionLabel>
        <DataTable
          rows={projects}
          columns={columns}
          rowKey={(p) => p.application_id}
          emptyMessage={`No projects attributed to ${orgName} in this analysis sample.`}
        />
      </div>

      {/* Cross-link to the unscoped platform-wide org page */}
      <Link
        href={detailHref(`/org/${encodeURIComponent(orgName)}`, inShare)}
        className="group block bg-white rounded-lg border border-gray-200 hover:border-[#E07A5F] hover:shadow-sm transition-all px-5 py-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-1.5 bg-[#FDF2EF] rounded-md flex-shrink-0">
              <Building2 className="w-4 h-4 text-[#E07A5F]" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 group-hover:text-[#E07A5F] transition-colors leading-snug">
                See {orgName}&rsquo;s full platform profile
              </div>
              <div className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">
                Cross-source view across the entire granted.bio dataset — projects, trials, patents, and publications spanning every topic, not just this analysis.
              </div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-[#E07A5F] transition-colors flex-shrink-0" strokeWidth={2} />
        </div>
      </Link>
    </div>
  )
}
