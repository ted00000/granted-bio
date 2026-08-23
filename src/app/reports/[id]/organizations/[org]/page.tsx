// Analysis-scoped org detail. Lists all projects in this specific
// analysis attributed to one organization. Distinct from /org/[name]
// which is the unscoped platform-wide profile.
//
// The org identifier in the URL is a `%`-encoded org_name (matches
// the same encoding scheme used elsewhere — Funding Landscape rows,
// Organizations table, Projects/Researchers org columns all link
// here with encodeURIComponent).

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, ArrowLeft } from 'lucide-react'
import { getReport } from '@/lib/reports/fetch-report'
import { extractScopeWarning } from '../../section-utils'
import { MarkdownRenderer } from '../../MarkdownRenderer'
import { OrgDetailView } from './OrgDetailView'

interface AgentOutputs {
  projects?: {
    items?: Array<{
      application_id: string
      project_number: string | null
      title: string
      pi_names: string | null
      org_name: string | null
      total_cost: number | null
      primary_category: string | null
    }>
  }
}

export default async function ScopedOrgPage({
  params,
}: {
  params: Promise<{ id: string; org: string }>
}) {
  const { id, org: encodedOrg } = await params
  const orgName = decodeURIComponent(encodedOrg)
  const report = await getReport(id)
  if (!report) notFound()

  const ao = (report.agent_outputs ?? {}) as AgentOutputs
  const allProjects = ao.projects?.items ?? []
  const orgProjects = allProjects
    .filter((p) => p.org_name === orgName)
    .sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0))

  // If no projects match, this is a stale link — the org existed in a
  // previous version of the analysis but not this one. Send the reader
  // back to the Organizations index rather than showing an empty shell.
  if (orgProjects.length === 0) notFound()

  const totalFunding = orgProjects.reduce((sum, p) => sum + (p.total_cost ?? 0), 0)
  const scopeWarning = extractScopeWarning(report.markdown_content ?? '')

  return (
    <div className="min-h-full">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-5 sm:px-6">
          {/* Back link — dedicated affordance to return to the parent
              Organizations list. Sits above the breadcrumb so it's
              the first thing a reader looking to escape sees. */}
          <Link
            href={`/reports/${report.id}/organizations`}
            className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-[#E07A5F] transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
            <span>Back to Organizations</span>
          </Link>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2 flex-wrap">
            <Link
              href={`/reports/${report.id}`}
              className="hover:text-gray-700 transition-colors truncate max-w-xs"
            >
              {report.topic || report.title}
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <Link
              href={`/reports/${report.id}/organizations`}
              className="hover:text-gray-700 transition-colors"
            >
              Organizations
            </Link>
            <ChevronRight className="w-3 h-3 flex-shrink-0" />
            <span className="text-gray-700 truncate max-w-md" title={orgName}>
              {orgName}
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight leading-tight">
            {orgName}
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-3xl leading-relaxed">
            Projects attributed to {orgName} within this analysis sample.
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {scopeWarning && (
          <div className="mb-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <MarkdownRenderer content={scopeWarning} compact />
            </div>
          </div>
        )}
        <OrgDetailView
          orgName={orgName}
          projects={orgProjects}
          totalFunding={totalFunding}
        />
      </div>
    </div>
  )
}
