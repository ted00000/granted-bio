'use client'

// Client-side table for the Organizations Data page. Owns column
// definitions so it can render inside <ExpandableDataTable> (top-N
// ↔ all toggle + pagination). Server wrapper (OrganizationsView)
// threads basePath through — org drill-in stays inside the report
// tree, so no ?from=share needed.

import { type Column } from '../DataTable'
import { InternalLink } from '../EntityLink'
import { ExpandableDataTable } from '../ExpandableDataTable'

interface Org {
  org_name: string
  projects: number
  funding: number
  trials: number
  patents: number
  publications?: number
}

interface OrganizationsTableProps {
  topOrgs: Org[]
  /** Full sorted list. Null for legacy reports pre-2026-09-01. */
  allOrgs: Org[] | null
  totalOrgs: number
  basePath: string
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export function OrganizationsTable({
  topOrgs,
  allOrgs,
  totalOrgs,
  basePath,
}: OrganizationsTableProps) {
  const columns: Column<Org>[] = [
    {
      label: 'Organization',
      widthClass: 'w-2/5',
      render: (o) => (
        <InternalLink
          href={`${basePath}/organizations/${encodeURIComponent(o.org_name)}`}
          className="text-gray-900 font-medium leading-snug block"
        >
          {o.org_name}
        </InternalLink>
      ),
    },
    {
      label: 'Projects',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (o) => o.projects.toLocaleString(),
    },
    {
      label: 'Funding',
      align: 'right',
      cellClass: 'tabular-nums font-medium text-gray-900',
      render: (o) => formatMoney(o.funding),
    },
    {
      label: 'Trials',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (o) => (o.trials > 0 ? o.trials.toLocaleString() : <span className="text-gray-300">—</span>),
    },
    {
      label: 'Patents',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (o) => (o.patents > 0 ? o.patents.toLocaleString() : <span className="text-gray-300">—</span>),
    },
    {
      label: 'Pubs',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (o) =>
        typeof o.publications === 'number' && o.publications > 0
          ? o.publications.toLocaleString()
          : <span className="text-gray-300">—</span>,
    },
  ]

  return (
    <ExpandableDataTable
      topRows={topOrgs}
      allRows={allOrgs}
      totalCount={totalOrgs}
      columns={columns}
      topLabel={`Top ${topOrgs.length} by Activity`}
      expandedLabel="All Organizations"
      rowKey={(o) => o.org_name}
      emptyMessage="No organizations in this analysis sample."
    />
  )
}
