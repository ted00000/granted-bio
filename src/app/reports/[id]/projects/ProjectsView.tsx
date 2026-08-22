// Bespoke render for the Projects Data page. Uses the report.projects
// column (top 20 by funding — the full sample-level project_count sits
// in funding_stats.projectCount and is surfaced in the caption).
//
// Design mirrors the Analysis pages: coral SectionLabel + shared
// DataTable + a small caption clarifying what the reader is seeing.

import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'

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

interface ProjectsViewProps {
  projects: Project[]
  totalProjects: number
  totalFunding: number
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

export function ProjectsView({ projects, totalProjects, totalFunding }: ProjectsViewProps) {
  const shownCount = projects.length
  const isTruncated = totalProjects > shownCount

  const columns: Column<Project>[] = [
    {
      label: 'Project',
      widthClass: 'w-2/5',
      render: (p) => (
        <div>
          <div className="text-gray-900 font-medium leading-snug mb-0.5">{p.title}</div>
          {p.project_number && (
            <div className="text-[11px] text-gray-400 tabular-nums">{p.project_number}</div>
          )}
        </div>
      ),
    },
    {
      label: 'PI',
      render: (p) => <span className="text-gray-700">{firstPI(p.pi_names)}</span>,
    },
    {
      label: 'Organization',
      render: (p) => <span className="text-gray-700 leading-snug block">{p.org_name || '—'}</span>,
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
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <SectionLabel className="mb-0" count={shownCount}>
          {isTruncated ? `Top ${shownCount} by Funding` : 'All Projects'}
        </SectionLabel>
        <div className="text-[12px] text-gray-500 tabular-nums">
          {isTruncated && (
            <>
              Showing {shownCount} of <span className="text-gray-700 font-medium">{totalProjects}</span>
              {' · '}
            </>
          )}
          <span className="text-gray-700 font-medium">{formatMoney(totalFunding)}</span> total funding
        </div>
      </div>
      <DataTable
        rows={projects}
        columns={columns}
        rowKey={(p) => p.application_id}
        emptyMessage="No projects in this analysis sample."
      />
    </div>
  )
}
