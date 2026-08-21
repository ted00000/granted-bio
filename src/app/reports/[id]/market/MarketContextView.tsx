// Bespoke render for the Market Context Analysis page. Uses the
// structured market_context column (see types.ts MarketContext).
//
// Content:
//   - Market size hero (when present) — bold single-line pull-out
//   - Overview narrative
//   - Key players grid (chips, click-safe for now, no drill-in)
//   - Recent developments as an editorial timeline list
//   - Competitive landscape narrative
//   - Sources list with external-link icons

import { MarkdownRenderer } from '../MarkdownRenderer'
import { Globe, TrendingUp, Users2, ExternalLink } from 'lucide-react'

interface MarketContext {
  overview: string
  marketSize: string | null
  keyPlayers: string[]
  recentDevelopments: string[]
  competitiveLandscape: string
  sources: string[]
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function MarketContextView({ market }: { market: MarketContext | null }) {
  if (!market) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Globe className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Market context was not gathered for this analysis.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Market size hero — pulled out visually when present */}
      {market.marketSize && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="h-1 bg-[#E07A5F]" />
          <div className="px-6 py-5">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Market size
            </div>
            <div className="text-lg font-semibold text-gray-900 leading-snug">
              {market.marketSize}
            </div>
          </div>
        </section>
      )}

      {/* Overview */}
      {market.overview && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Overview
          </div>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={market.overview} compact />
          </div>
        </section>
      )}

      {/* Key players grid */}
      {market.keyPlayers.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            <Users2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            Key Players ({market.keyPlayers.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {market.keyPlayers.map((player, i) => (
              <span
                key={i}
                className="inline-block px-3 py-1.5 text-sm bg-gray-50 text-gray-800 border border-gray-200 rounded-md"
              >
                {player}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Recent developments — editorial-style timeline */}
      {market.recentDevelopments.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.75} />
            Recent Developments ({market.recentDevelopments.length})
          </div>
          <ol className="space-y-3">
            {market.recentDevelopments.map((dev, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold flex items-center justify-center tabular-nums mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 text-[15px] text-gray-700 leading-relaxed pt-0.5">
                  {dev}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Competitive landscape narrative */}
      {market.competitiveLandscape && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Competitive Landscape
          </div>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={market.competitiveLandscape} compact />
          </div>
        </section>
      )}

      {/* Sources */}
      {market.sources.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Sources ({market.sources.length})
          </div>
          <ul className="space-y-1.5">
            {market.sources.map((src, i) => {
              const host = safeHost(src)
              const isUrl = /^https?:\/\//i.test(src)
              return (
                <li key={i} className="text-sm">
                  {isUrl ? (
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-gray-700 hover:text-[#E07A5F] transition-colors group"
                    >
                      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 text-gray-400 group-hover:text-[#E07A5F] transition-colors" strokeWidth={1.75} />
                      <span>{host}</span>
                    </a>
                  ) : (
                    <span className="text-gray-700">{src}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
