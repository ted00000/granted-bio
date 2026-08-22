import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'
import { InternalLink } from '../EntityLink'

interface Patent {
  patent_id: string
  patent_title: string | null
  assignee: string | null
  patent_date: string | null
  inventors: string | null
}

interface AssigneeRow {
  assignee: string
  count: number
}

interface PatentsViewProps {
  patents: Patent[]
  byAssignee?: AssigneeRow[]
  recentCount?: number
}

function formatInventors(names: string | null): string {
  if (!names) return '—'
  const list = names.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return '—'
  if (list.length === 1) return list[0]
  return `${list[0]} +${list.length - 1}`
}

export function PatentsView({ patents, byAssignee, recentCount }: PatentsViewProps) {
  const total = patents.length

  const columns: Column<Patent>[] = [
    {
      label: 'Patent',
      widthClass: 'w-2/5',
      render: (p) => (
        <div>
          <InternalLink
            href={`/patent/${p.patent_id}`}
            className="text-gray-900 font-medium leading-snug block mb-0.5"
          >
            {p.patent_title || '(No title)'}
          </InternalLink>
          <div className="text-[11px] text-gray-400 tabular-nums">{p.patent_id}</div>
        </div>
      ),
    },
    {
      label: 'Assignee',
      render: (p) => {
        if (!p.assignee) return <span className="text-gray-400">—</span>
        return (
          <InternalLink
            href={`/org/${encodeURIComponent(p.assignee)}`}
            className="text-gray-700 leading-snug block"
          >
            {p.assignee}
          </InternalLink>
        )
      },
    },
    {
      label: 'Inventors',
      render: (p) => (
        <span className="text-gray-600 text-[13px]">{formatInventors(p.inventors)}</span>
      ),
    },
    {
      label: 'Date',
      align: 'right',
      cellClass: 'tabular-nums text-gray-600 text-[13px]',
      render: (p) => p.patent_date ?? '—',
    },
  ]

  return (
    <div className="space-y-4">
      {byAssignee && byAssignee.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel className="mb-3">Top Assignees</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {byAssignee.slice(0, 8).map((row) => (
              <span
                key={row.assignee}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-50 text-gray-700 border border-gray-200 rounded"
              >
                {row.assignee}
                <span className="text-[11px] text-gray-400 tabular-nums">{row.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-baseline justify-between px-1">
        <SectionLabel className="mb-0" count={total}>Patents</SectionLabel>
        {typeof recentCount === 'number' && recentCount > 0 && (
          <div className="text-[12px] text-gray-500 tabular-nums">
            <span className="text-gray-700 font-medium">{recentCount}</span> filed recently
          </div>
        )}
      </div>
      <DataTable
        rows={patents}
        columns={columns}
        rowKey={(p) => p.patent_id}
        emptyMessage="No patents linked to this analysis sample."
      />
    </div>
  )
}
