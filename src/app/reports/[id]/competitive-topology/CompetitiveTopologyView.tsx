// Bespoke render for the Competitive Topology Analysis page. Uses
// agent_outputs.competitiveTopology (see types.ts CompetitiveTopology).
// Content:
//   - Narrative header (Claude's synthesis of how the field organizes)
//   - Cluster grid: each methodological cluster as its own card with
//     an approach headline, a maturity chip, a key-players list, and
//     a commercial readiness line
//   - Strategic implications block

import { MarkdownRenderer } from '../MarkdownRenderer'
import { SectionLabel } from '../SectionLabel'
import { Network, Target } from 'lucide-react'

interface Cluster {
  approach: string
  keyPlayers: string[]
  maturityLevel: string
  commercialReadiness: string
}

interface CompetitiveTopology {
  clusters: Cluster[]
  narrative: string
  strategicImplications?: string
}

// Map the free-text maturityLevel back to a color-coded chip. Values
// come from LLM synthesis so we normalize on lowercase substring
// matches — "Mature", "Emerging", "Nascent" are the common set but
// variants like "Established", "Early" or "In-progress" appear.
function maturityStyle(level: string): { chip: string; dot: string } {
  const s = level.toLowerCase()
  if (s.includes('mature') || s.includes('established')) return { chip: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' }
  if (s.includes('emerg') || s.includes('growing')) return { chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' }
  if (s.includes('nascent') || s.includes('early') || s.includes('exploratory')) return { chip: 'bg-rose-50 text-rose-800', dot: 'bg-rose-500' }
  return { chip: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' }
}

export function CompetitiveTopologyView({ topology }: { topology: CompetitiveTopology | null }) {
  if (!topology) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Network className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Competitive topology was not computed for this analysis.
        </p>
      </div>
    )
  }

  const total = topology.clusters.length

  return (
    <div className="space-y-5">
      {topology.narrative && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Overview</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={topology.narrative} compact />
          </div>
        </section>
      )}

      {total > 0 && (
        <div>
          <SectionLabel className="mb-3 px-1" count={total}>
            Methodological Clusters
          </SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topology.clusters.map((cluster, i) => {
              const style = maturityStyle(cluster.maturityLevel)
              return (
                <article
                  key={i}
                  className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className={`h-1 ${style.dot}`} />
                  <div className="px-5 py-4">
                    <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">
                      Cluster {i + 1} of {total}
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 leading-snug mb-3">
                      {cluster.approach}
                    </h3>
                    <div className="mb-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${style.chip}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {cluster.maturityLevel}
                      </span>
                    </div>

                    {cluster.keyPlayers.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                          Key players
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {cluster.keyPlayers.slice(0, 8).map((player, j) => (
                            <span
                              key={j}
                              className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                            >
                              {player}
                            </span>
                          ))}
                          {cluster.keyPlayers.length > 8 && (
                            <span className="inline-block px-2 py-0.5 text-xs text-gray-400">
                              +{cluster.keyPlayers.length - 8} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {cluster.commercialReadiness && (
                      <div>
                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                          Commercial readiness
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {cluster.commercialReadiness}
                        </p>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {topology.strategicImplications && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel icon={Target}>Strategic Implications</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={topology.strategicImplications} compact />
          </div>
        </section>
      )}
    </div>
  )
}
