// Server wrapper for the Researchers Data page. Computes share
// context (basePath + inShare), delegates rendering to the client
// ResearchersTable which owns the top/all toggle + pagination.

import { getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { ResearchersTable } from './ResearchersTable'

interface Researcher {
  pi_name: string
  projects: number
  funding: number
  org: string | null
}

interface ResearchersViewProps {
  reportId: string
  researchers: Researcher[]
  allResearchers: Researcher[] | null
  totalPIs: number
}

export async function ResearchersView({
  reportId,
  researchers,
  allResearchers,
  totalPIs,
}: ResearchersViewProps) {
  const share = await getShareContextFromHeaders()
  const inShare = !!share && share.report_id === reportId
  const basePath = inShare ? `/share/${share!.token}` : `/reports/${reportId}`

  return (
    <ResearchersTable
      topResearchers={researchers}
      allResearchers={allResearchers}
      totalPIs={totalPIs}
      basePath={basePath}
      inShare={inShare}
    />
  )
}
