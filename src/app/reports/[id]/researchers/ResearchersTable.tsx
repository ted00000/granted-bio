'use client'

// Client-side table for the Researchers Data page. Owns column
// definitions so it can render inside <ExpandableDataTable> (top-N
// ↔ all toggle + pagination). Server wrapper threads basePath +
// inShare for correct drill-in scoping.

import { type Column } from '../DataTable'
import { InternalLink } from '../EntityLink'
import { ExpandableDataTable } from '../ExpandableDataTable'
import { detailHref } from '@/lib/reports/share-nav'

interface Researcher {
  pi_name: string
  projects: number
  funding: number
  org: string | null
}

interface ResearchersTableProps {
  topResearchers: Researcher[]
  /** Full sorted list. Null for legacy reports pre-2026-09-01. */
  allResearchers: Researcher[] | null
  totalPIs: number
  basePath: string
  inShare: boolean
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

// Normalize a PI name for display. Storage typically uses `LAST, FIRST
// MIDDLE` all-caps as it came from RePORTER. Display in Title Case as
// `First Middle Last` for readability.
function displayName(raw: string): string {
  const lower = raw.toLowerCase().trim()
  const commaIdx = lower.indexOf(',')
  const swapped = commaIdx > 0
    ? `${lower.slice(commaIdx + 1).trim()} ${lower.slice(0, commaIdx).trim()}`
    : lower
  return swapped.replace(/\s+/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

export function ResearchersTable({
  topResearchers,
  allResearchers,
  totalPIs,
  basePath,
  inShare,
}: ResearchersTableProps) {
  const columns: Column<Researcher>[] = [
    {
      label: 'Principal Investigator',
      widthClass: 'w-1/3',
      render: (r) => (
        <InternalLink
          href={detailHref(`/researcher/${encodeURIComponent(r.pi_name)}`, inShare)}
          className="text-gray-900 font-medium"
        >
          {displayName(r.pi_name)}
        </InternalLink>
      ),
    },
    {
      label: 'Organization',
      render: (r) => {
        if (!r.org) return <span className="text-gray-400">—</span>
        return (
          <InternalLink
            href={`${basePath}/organizations/${encodeURIComponent(r.org)}`}
            className="text-gray-700 leading-snug block"
          >
            {r.org}
          </InternalLink>
        )
      },
    },
    {
      label: 'Projects',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (r) => r.projects.toLocaleString(),
    },
    {
      label: 'Funding',
      align: 'right',
      cellClass: 'tabular-nums font-medium text-gray-900',
      render: (r) => formatMoney(r.funding),
    },
  ]

  return (
    <ExpandableDataTable
      topRows={topResearchers}
      allRows={allResearchers}
      totalCount={totalPIs}
      columns={columns}
      topLabel={`Top ${topResearchers.length} by Funding`}
      expandedLabel="All Researchers"
      rowKey={(r) => r.pi_name}
      emptyMessage="No researchers in this analysis sample."
    />
  )
}
