import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'
import { InternalLink } from '../EntityLink'

interface Researcher {
  pi_name: string
  projects: number
  funding: number
  org: string | null
}

interface ResearchersViewProps {
  reportId: string
  researchers: Researcher[]
  totalPIs: number
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

export function ResearchersView({ reportId, researchers, totalPIs }: ResearchersViewProps) {
  const shown = researchers.length
  const isTruncated = totalPIs > shown

  const columns: Column<Researcher>[] = [
    {
      label: 'Principal Investigator',
      widthClass: 'w-1/3',
      render: (r) => (
        <InternalLink
          href={`/researcher/${encodeURIComponent(r.pi_name)}`}
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
            href={`/reports/${reportId}/organizations/${encodeURIComponent(r.org)}`}
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
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <SectionLabel className="mb-0" count={shown}>
          {isTruncated ? `Top ${shown} by Funding` : 'All Researchers'}
        </SectionLabel>
        {isTruncated && (
          <div className="text-[12px] text-gray-500 tabular-nums">
            Showing {shown} of <span className="text-gray-700 font-medium">{totalPIs}</span> total PIs
          </div>
        )}
      </div>
      <DataTable
        rows={researchers}
        columns={columns}
        rowKey={(r) => r.pi_name}
        emptyMessage="No researchers in this analysis sample."
      />
    </div>
  )
}
