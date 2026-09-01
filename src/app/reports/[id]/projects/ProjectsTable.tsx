'use client'

// Client-side table for the Projects Data page. Owns the column
// definitions so it can render inside <ExpandableDataTable>, which
// handles top-N ↔ all toggle + pagination.
//
// The server-side ProjectsView calls this and threads through raw
// data + basePath + inShare so link construction (which mixes
// share-scoped analysis routes with global detail pages carrying
// ?from=share) still works.

import { type Column } from '../DataTable'
import { InternalLink } from '../EntityLink'
import { ExpandableDataTable } from '../ExpandableDataTable'
import { detailHref } from '@/lib/reports/share-nav'

interface Project {
  application_id: string
  project_number: string | null
  title: string
  pi_names: string | null
  org_name: string | null
  total_cost: number | null
  primary_category: string | null
  match_tier: 'precise' | 'balanced' | 'broad' | null
}

interface ProjectsTableProps {
  /** Top-N slice (top 20 by funding) — the default view. */
  topProjects: Project[]
  /** Full analyzed sample. Null for legacy reports (pre-2026-09-01);
   *  the "Show all" toggle is hidden in that case. */
  allProjects: Project[] | null
  /** True count of projects in the analyzed sample (from
   *  funding_stats.projectCount). Used for the header caption. */
  totalProjects: number
  /** URL prefix for report-scoped links — /reports/[id] in owner
   *  view, /share/[token] in share view. */
  basePath: string
  /** Whether we're rendering under a share URL — used to append
   *  ?from=share to global detail-page links. */
  inShare: boolean
}

function formatMoney(n: number | null): string {
  if (!n) return '—'
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

export function ProjectsTable({
  topProjects,
  allProjects,
  totalProjects,
  basePath,
  inShare,
}: ProjectsTableProps) {
  const columns: Column<Project>[] = [
    {
      label: 'Project',
      widthClass: 'w-2/5',
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
          <InternalLink
            href={detailHref(`/researcher/${encodeURIComponent(name)}`, inShare)}
            className="text-gray-700"
          >
            {name}
          </InternalLink>
        )
      },
    },
    {
      label: 'Organization',
      render: (p) => {
        if (!p.org_name) return <span className="text-gray-400">—</span>
        return (
          <InternalLink
            href={`${basePath}/organizations/${encodeURIComponent(p.org_name)}`}
            className="text-gray-700 leading-snug block"
          >
            {p.org_name}
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
    <ExpandableDataTable
      topRows={topProjects}
      allRows={allProjects}
      totalCount={totalProjects}
      columns={columns}
      topLabel={`Top ${topProjects.length} by Funding`}
      expandedLabel="All Projects"
      rowKey={(p) => p.application_id}
      emptyMessage="No projects in this analysis sample."
    />
  )
}
