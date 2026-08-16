// Structured render for the "What Surprised Us" page. Departs from the
// PortalSectionView + MarkdownRenderer treatment so each finding gets
// a properly designed card rather than a raw-markdown dump.
//
// Design decisions (2026-08-16 polish pass):
//   - Confidence signaled TWICE — a colored top-border on the card
//     matches the confidence tier's color (rose/amber/emerald) so a
//     scroll-past reader gets confidence at a glance without reading
//     the chip. The chip itself stays for explicit labeling.
//   - Larger numbered badge (40px) with brand-orange fill so the eye
//     lands on the card's identity before the headline.
//   - Larger, tighter headline (text-lg font-semibold leading-tight)
//     to give the finding a real title, not a bolded prose line.
//   - Body paragraph uses text-[15px] text-gray-600 so the hierarchy
//     of headline > body > meta is unambiguous.
//   - Evidence rendered inside a subtle tinted panel so it reads as
//     "supporting detail" rather than another gray line.
//   - "Finding N of M" position marker so the reader knows where they
//     are in the list.

import { MarkdownRenderer } from '../MarkdownRenderer'
import { Sparkles } from 'lucide-react'
import type { SurprisingFinding, Confidence } from './parse'

interface SurprisingFindingsViewProps {
  caption: string
  findings: SurprisingFinding[]
  emptyMessage?: string
}

interface ConfidenceStyle {
  /** Card top-border color (Tailwind class) */
  topBorder: string
  /** Chip background + text + border classes */
  chip: string
  /** Chip dot color */
  dot: string
  /** Human label */
  label: string
}

const CONFIDENCE_STYLES: Record<Confidence, ConfidenceStyle> = {
  High: {
    topBorder: 'bg-emerald-400',
    chip: 'bg-emerald-50 text-emerald-800',
    dot: 'bg-emerald-500',
    label: 'High confidence',
  },
  Medium: {
    topBorder: 'bg-amber-400',
    chip: 'bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
    label: 'Medium confidence',
  },
  Low: {
    topBorder: 'bg-rose-400',
    chip: 'bg-rose-50 text-rose-800',
    dot: 'bg-rose-500',
    label: 'Low confidence',
  },
}

export function SurprisingFindingsView({
  caption,
  findings,
  emptyMessage,
}: SurprisingFindingsViewProps) {
  if (findings.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Sparkles className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          {emptyMessage ||
            'This analysis did not surface any surprising findings — most commonly because the sample size was small or all signals fell within expected patterns.'}
        </p>
      </div>
    )
  }

  const total = findings.length

  return (
    <div className="space-y-6">
      {caption && (
        <aside className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-[#E07A5F]" strokeWidth={1.75} />
          </div>
          {/* Inline-markdown parsed so `**flagged hypotheses**` in the
              default caption renders as actual bold rather than literal
              asterisks. Uses MarkdownRenderer's `compact` mode with the
              wrapper's own paragraph-margin reset so the callout stays
              visually tight. */}
          <div className="text-sm text-gray-600 leading-relaxed [&_p]:my-0 [&_p+p]:mt-2">
            <MarkdownRenderer content={caption} compact />
          </div>
        </aside>
      )}

      <div className="space-y-4">
        {findings.map((f) => {
          const confStyle = f.confidence ? CONFIDENCE_STYLES[f.confidence] : null
          return (
            <article
              key={f.index}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Confidence tier signal — colored top border so the
                  reader can scan cards and know confidence without
                  reading the chip. Falls back to a neutral gray when
                  no confidence tag was extracted. */}
              <div className={`h-1 ${confStyle ? confStyle.topBorder : 'bg-gray-200'}`} />

              <div className="px-6 py-5">
                {/* Position marker only. The numbered badge was pulled
                    (2026-08-16) — it repeated info already in this
                    text label and its bold orange competed with the
                    confidence top-border for visual identity. Card
                    identity now comes from the border color + this
                    label + the headline hierarchy. */}
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Finding {f.index} of {total}
                </div>

                {/* Headline — larger, tighter, real hierarchy */}
                <h3 className="text-lg font-semibold text-gray-900 leading-snug mb-3">
                  {f.headline}
                </h3>

                {/* Interpretation body. compact + [&_p]:my-0 kills the
                    MarkdownRenderer's default paragraph margins so
                    the surrounding card padding controls rhythm. */}
                <div className="text-[15px] text-gray-600 leading-relaxed [&_p]:my-0 [&_p+p]:mt-3">
                  <MarkdownRenderer content={f.interpretation} compact />
                </div>

                {/* Confidence chip + evidence panel. Both live inside a
                    single meta section separated from the body by
                    generous whitespace. Evidence sits inside a subtle
                    tinted panel so it reads as "supporting detail"
                    rather than a plain gray line. */}
                {(confStyle || f.evidence) && (
                  <div className="mt-5 space-y-2.5">
                    {confStyle && (
                      <div>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${confStyle.chip}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${confStyle.dot}`} />
                          {confStyle.label}
                        </span>
                      </div>
                    )}
                    {f.evidence && (
                      <div className="bg-gray-50 rounded-md px-3 py-2 border border-gray-100">
                        <p className="text-xs text-gray-600 leading-relaxed">
                          <span className="font-semibold text-gray-700 uppercase tracking-wider text-[10px] mr-1.5">
                            Evidence
                          </span>
                          {f.evidence}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
