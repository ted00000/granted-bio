// Server component for the Projects Data page. Computes the share
// context (basePath + inShare) that the client-side ProjectsTable
// needs to build correctly-scoped drill-in links, then delegates
// rendering. The client wrapper owns the top/all toggle +
// pagination + column definitions.

import { getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { ProjectsTable } from './ProjectsTable'

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
  reportId: string
  projects: Project[]
  /** Full analyzed sample (null for pre-2026-09-01 reports). */
  allProjects: Project[] | null
  totalProjects: number
  totalFunding: number
}

function formatMoney(n: number): string {
  if (!n) return '$0'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export async function ProjectsView({
  reportId,
  projects,
  allProjects,
  totalProjects,
  totalFunding,
}: ProjectsViewProps) {
  const share = await getShareContextFromHeaders()
  const inShare = !!share && share.report_id === reportId
  const basePath = inShare ? `/share/${share!.token}` : `/reports/${reportId}`

  return (
    <div className="space-y-4">
      <ProjectsTable
        topProjects={projects}
        allProjects={allProjects}
        totalProjects={totalProjects}
        basePath={basePath}
        inShare={inShare}
      />
      {/* Funding total caption sits below the table since the
          expandable header already carries the "N of M" count.
          Keeps the header lean when the toggle is present. */}
      <div className="text-[12px] text-gray-500 tabular-nums px-1">
        <span className="text-gray-700 font-medium">{formatMoney(totalFunding)}</span> total funding across the analyzed sample
      </div>
    </div>
  )
}
