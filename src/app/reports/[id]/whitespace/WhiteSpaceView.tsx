// Bespoke render for the White Space Analysis page. Uses the
// structured agent_outputs.whiteSpace shape (see types.ts
// WhiteSpaceAnalysis).
//
// Content:
//   - Overview + scope note (framing)
//   - Topic-relevance callout (when weak/off-topic — signals that
//     the sample doesn't cover the head-term axis well)
//   - Dimension cards (one per dimension): category table with
//     project count, share, and broader-NIH cross-reference; then
//     Claude's narrative for the dimension
//   - Top opportunities list (prioritized gap signals)
//   - Strategic implications

import { MarkdownRenderer } from '../MarkdownRenderer'
import { SectionLabel } from '../SectionLabel'
import { Compass, AlertTriangle } from 'lucide-react'

interface Category {
  name: string
  keywords: string[]
  projectCount: number
  fundingTotal: number
  broaderNihCount: number
  projectExamples: string[]
}

interface Dimension {
  name: string
  description: string
  categories: Category[]
  totalMatched: number
  totalUnclassified: number
  narrative: string
}

interface Opportunity {
  dimensionName: string
  categoryName: string
  sampleCount: number
  sampleShare: number
  broaderNihCount: number
  gapSignal: 'sparse-in-topic' | 'absent-in-topic' | 'sample-under-broader'
  rationale: string
}

interface TopicRelevance {
  onTopicCount: number
  adjacentCount: number
  onTopicRatio: number
  tier: 'strong' | 'moderate' | 'weak' | 'off-topic'
  coreTokens: string[]
}

interface WhiteSpace {
  overview: string
  scopeNote: string
  dimensions: Dimension[]
  topOpportunities: Opportunity[]
  totalProjects: number
  totalFunding: number
  strategicImplications?: string
  broaderNihScopeLabel?: string
  scopeUniverseCount?: number | null
  topicRelevance?: TopicRelevance
}

const GAP_SIGNAL_STYLES: Record<Opportunity['gapSignal'], { chip: string; label: string }> = {
  'absent-in-topic':      { chip: 'bg-rose-50 text-rose-800',      label: 'Absent in topic' },
  'sparse-in-topic':      { chip: 'bg-amber-50 text-amber-800',    label: 'Sparse in topic' },
  'sample-under-broader': { chip: 'bg-sky-50 text-sky-800',        label: 'Under-represented' },
}

function formatMoney(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

export function WhiteSpaceView({ whiteSpace }: { whiteSpace: WhiteSpace | null }) {
  if (!whiteSpace || whiteSpace.dimensions.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Compass className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          White space analysis was not computed for this analysis — typically because the sample size was too small to compute meaningful gap signals.
        </p>
      </div>
    )
  }

  const relevance = whiteSpace.topicRelevance
  const showRelevanceWarning = relevance && (relevance.tier === 'weak' || relevance.tier === 'off-topic')

  return (
    <div className="space-y-5">
      {/* Overview + scope note */}
      {whiteSpace.overview && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Overview</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={whiteSpace.overview} compact />
          </div>
          {whiteSpace.scopeNote && (
            <p className="text-[13px] text-gray-500 italic mt-3 pt-3 border-t border-gray-100 leading-relaxed">
              {whiteSpace.scopeNote}
            </p>
          )}
        </section>
      )}

      {/* Topic-relevance warning callout */}
      {showRelevanceWarning && relevance && (
        <aside className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="text-sm text-amber-900 leading-relaxed">
            <span className="font-semibold">Sample coverage note.</span>{' '}
            Only {relevance.onTopicCount} of {relevance.onTopicCount + relevance.adjacentCount} sample
            projects ({(relevance.onTopicRatio * 100).toFixed(0)}%) explicitly carry the topic&apos;s core
            vocabulary. Gap signals below reflect what&apos;s present or absent in the retrieved sample —
            adjacent-topic projects may not follow the same coverage patterns.
          </div>
        </aside>
      )}

      {/* Dimension cards */}
      <div>
        <SectionLabel className="mb-3 px-1" count={whiteSpace.dimensions.length}>
          Coverage Dimensions
        </SectionLabel>
        <div className="space-y-4">
          {whiteSpace.dimensions.map((dim, i) => (
            <article
              key={i}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="px-6 py-5">
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Dimension {i + 1} of {whiteSpace.dimensions.length}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 leading-snug mb-1">
                  {dim.name}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-4">
                  {dim.description}
                </p>

                {dim.categories.length > 0 && (
                  <div className="my-4 -mx-6 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-y border-gray-200 bg-gray-50/60">
                          <th className="px-6 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                            Category
                          </th>
                          <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                            Sample
                          </th>
                          <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                            Funding
                          </th>
                          <th className="px-6 py-2 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                            {whiteSpace.broaderNihScopeLabel ? 'Broader NIH' : 'NIH-wide'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dim.categories.map((cat) => {
                          const share = whiteSpace.totalProjects > 0
                            ? ((cat.projectCount / whiteSpace.totalProjects) * 100).toFixed(0)
                            : '0'
                          return (
                            <tr key={cat.name} className="border-b border-gray-100 last:border-b-0">
                              <td className="px-6 py-2 text-[14px] text-gray-900">
                                {cat.name}
                              </td>
                              <td className="px-4 py-2 text-[14px] text-gray-700 tabular-nums text-right">
                                {cat.projectCount}
                                <span className="text-[12px] text-gray-400 ml-1">
                                  ({share}%)
                                </span>
                              </td>
                              <td className="px-4 py-2 text-[14px] text-gray-700 tabular-nums text-right">
                                {cat.fundingTotal > 0 ? formatMoney(cat.fundingTotal) : '—'}
                              </td>
                              <td className="px-6 py-2 text-[14px] text-gray-500 tabular-nums text-right">
                                {cat.broaderNihCount.toLocaleString()}
                              </td>
                            </tr>
                          )
                        })}
                        {dim.totalUnclassified > 0 && (
                          <tr className="border-b border-gray-100">
                            <td className="px-6 py-2 text-[13px] text-gray-400 italic">
                              Not classified
                            </td>
                            <td className="px-4 py-2 text-[13px] text-gray-400 tabular-nums text-right">
                              {dim.totalUnclassified}
                            </td>
                            <td className="px-4 py-2" />
                            <td className="px-6 py-2" />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {dim.narrative && (
                  <div className="mt-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                    <MarkdownRenderer content={dim.narrative} compact />
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Top opportunities */}
      {whiteSpace.topOpportunities.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Top Gap Opportunities</SectionLabel>
          <div className="space-y-3">
            {whiteSpace.topOpportunities.slice(0, 8).map((opp, i) => {
              const gapStyle = GAP_SIGNAL_STYLES[opp.gapSignal]
              return (
                <div
                  key={i}
                  className="bg-gray-50 rounded-md px-4 py-3 border border-gray-100"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div>
                      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-0.5">
                        {opp.dimensionName}
                      </div>
                      <div className="text-sm font-semibold text-gray-900">
                        {opp.categoryName}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded flex-shrink-0 ${gapStyle.chip}`}
                    >
                      {gapStyle.label}
                    </span>
                  </div>
                  <div className="text-[13px] text-gray-500 tabular-nums mb-1.5">
                    Sample: {opp.sampleCount} ({(opp.sampleShare * 100).toFixed(0)}%) · Broader NIH: {opp.broaderNihCount.toLocaleString()}
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {opp.rationale}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Strategic implications */}
      {whiteSpace.strategicImplications && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Strategic Implications</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={whiteSpace.strategicImplications} compact />
          </div>
        </section>
      )}
    </div>
  )
}
