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
import { SectionLabel } from '../SectionLabel'
import { Globe, ExternalLink } from 'lucide-react'

interface MarketSizeScenario {
  label: string
  startValue: number
  startYear: number
  endValue: number
  endYear: number
  cagr: number
  source: string
}

interface MarketSizingStructured {
  scenarios: MarketSizeScenario[]
  firmRange?: { min: number; max: number; year: number } | null
}

interface MarketContext {
  overview: string
  marketSize: string | null
  marketSizing?: MarketSizingStructured | null
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
      {/* Market size hero. When structured marketSizing is available
          (new reports 2026-08-23+), render stat tiles per scenario +
          firm-range callout + the prose as narrative context below.
          Legacy reports fall through to prose-only. */}
      {(market.marketSize || (market.marketSizing?.scenarios.length ?? 0) > 0) && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="h-1 bg-[#E07A5F]" />
          <div className="px-6 py-5">
            <SectionLabel className="mb-4">Market Size</SectionLabel>

            {market.marketSizing && market.marketSizing.scenarios.length > 0 && (
              <div className="space-y-5 mb-5">
                {market.marketSizing.scenarios.map((s, i) => (
                  <MarketScenarioTile key={i} scenario={s} />
                ))}
                {market.marketSizing.firmRange && (
                  <FirmRangeCallout range={market.marketSizing.firmRange} />
                )}
              </div>
            )}

            {market.marketSize && (
              <div className={`text-[14px] text-gray-500 leading-relaxed ${market.marketSizing ? 'pt-4 border-t border-gray-100' : ''}`}>
                {market.marketSize}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Overview */}
      {market.overview && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Overview</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={market.overview} compact />
          </div>
        </section>
      )}

      {/* Key players grid */}
      {market.keyPlayers.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel count={market.keyPlayers.length}>Key Players</SectionLabel>
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
          <SectionLabel count={market.recentDevelopments.length}>Recent Developments</SectionLabel>
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
          <SectionLabel>Competitive Landscape</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={market.competitiveLandscape} compact />
          </div>
        </section>
      )}

      {/* Sources */}
      {market.sources.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel count={market.sources.length}>Sources</SectionLabel>
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

// ------------------------------------------------------------------
// Market-size structured render primitives
// ------------------------------------------------------------------

function formatBillions(value: number): string {
  if (value >= 1) return `$${value.toFixed(value >= 10 ? 1 : 2)}B`
  const inMillions = value * 1000
  if (inMillions >= 100) return `$${Math.round(inMillions)}M`
  return `$${inMillions.toFixed(0)}M`
}

function MarketScenarioTile({ scenario }: { scenario: MarketSizeScenario }) {
  const span = scenario.endYear - scenario.startYear
  return (
    <div>
      <div className="text-[13px] font-semibold text-gray-800 mb-2 leading-snug">
        {scenario.label}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-md px-3 py-3 border border-gray-100">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            {scenario.startYear}
          </div>
          <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
            {formatBillions(scenario.startValue)}
          </div>
        </div>
        <div className="bg-gray-50 rounded-md px-3 py-3 border border-gray-100">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            {scenario.endYear} projected
          </div>
          <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
            {formatBillions(scenario.endValue)}
          </div>
        </div>
        <div className="bg-[#FDF2EF] rounded-md px-3 py-3 border border-[#E07A5F]/20">
          <div className="text-[10px] font-semibold text-[#E07A5F] uppercase tracking-wider mb-1">
            CAGR
          </div>
          <div className="text-xl font-semibold text-gray-900 tabular-nums leading-tight">
            {scenario.cagr.toFixed(1)}%
          </div>
          {span > 0 && (
            <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
              {span}-yr window
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 mt-2 italic">
        Source: {scenario.source}
      </div>
    </div>
  )
}

function FirmRangeCallout({
  range,
}: {
  range: { min: number; max: number; year: number }
}) {
  // Range width as % of max — used to place the min-endpoint marker
  // visually along a track between 0 and max.
  const minPct = range.max > 0 ? Math.max(2, (range.min / range.max) * 100) : 0
  return (
    <div className="bg-gray-50 rounded-md px-4 py-3 border border-gray-100">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
          Cross-firm range · {range.year}
        </div>
        <div className="text-[13px] text-gray-700 tabular-nums">
          <span className="font-semibold text-gray-900">{formatBillions(range.min)}</span>
          <span className="text-gray-400 mx-1.5">to</span>
          <span className="font-semibold text-gray-900">{formatBillions(range.max)}</span>
        </div>
      </div>
      {/* Visual range indicator — bar spans min→max within the 0→max
          scale so readers see how wide the disagreement is. */}
      <div className="relative h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="absolute h-full bg-[#E07A5F]/60"
          style={{ left: `${minPct}%`, right: '0%' }}
        />
      </div>
      <div className="text-[11px] text-gray-500 mt-1.5 italic leading-relaxed">
        Estimates vary by scope definition across research firms — treat these figures as directional.
      </div>
    </div>
  )
}
