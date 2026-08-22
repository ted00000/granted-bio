import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'

interface Org {
  org_name: string
  projects: number
  funding: number
  trials: number
  patents: number
  publications?: number
}

interface OrganizationsViewProps {
  orgs: Org[]
  totalOrgs: number
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export function OrganizationsView({ orgs, totalOrgs }: OrganizationsViewProps) {
  const shown = orgs.length
  const isTruncated = totalOrgs > shown

  const columns: Column<Org>[] = [
    {
      label: 'Organization',
      widthClass: 'w-2/5',
      render: (o) => <span className="text-gray-900 font-medium leading-snug block">{o.org_name}</span>,
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
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <SectionLabel className="mb-0" count={shown}>
          {isTruncated ? `Top ${shown} by Funding` : 'All Organizations'}
        </SectionLabel>
        {isTruncated && (
          <div className="text-[12px] text-gray-500 tabular-nums">
            Showing {shown} of <span className="text-gray-700 font-medium">{totalOrgs}</span> total organizations
          </div>
        )}
      </div>
      <DataTable
        rows={orgs}
        columns={columns}
        rowKey={(o) => o.org_name}
        emptyMessage="No organizations in this analysis sample."
      />
    </div>
  )
}
