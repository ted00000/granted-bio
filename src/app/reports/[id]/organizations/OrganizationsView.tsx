// Server wrapper for the Organizations Data page. Computes share
// context (basePath), delegates rendering to the client
// OrganizationsTable which owns the top/all toggle + pagination.

import { getShareContextFromHeaders } from '@/lib/reports/fetch-report'
import { OrganizationsTable } from './OrganizationsTable'

interface Org {
  org_name: string
  projects: number
  funding: number
  trials: number
  patents: number
  publications?: number
}

interface OrganizationsViewProps {
  reportId: string
  orgs: Org[]
  allOrgs: Org[] | null
  totalOrgs: number
}

export async function OrganizationsView({
  reportId,
  orgs,
  allOrgs,
  totalOrgs,
}: OrganizationsViewProps) {
  const share = await getShareContextFromHeaders()
  const inShare = !!share && share.report_id === reportId
  const basePath = inShare ? `/share/${share!.token}` : `/reports/${reportId}`

  return (
    <OrganizationsTable
      topOrgs={orgs}
      allOrgs={allOrgs}
      totalOrgs={totalOrgs}
      basePath={basePath}
    />
  )
}
