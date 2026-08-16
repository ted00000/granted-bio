// Structured render for the "What Surprised Us" page. Replaces the
// generic markdown-slice + MarkdownRenderer treatment that previously
// showed inline confidence tags mid-paragraph and used bold text as
// pseudo-headings.
//
// Each finding renders as its own card:
//   - Numbered badge (colored circle) in the top-left
//   - Real H3 headline
//   - Body paragraph (interpretation, cleaned of inline confidence)
//   - Colored confidence chip at the bottom (Low=rose, Medium=amber,
//     High=emerald), always positioned consistently
//   - Optional evidence line rendered as small italic below the chip

import { MarkdownRenderer } from '../MarkdownRenderer'
import { Sparkles } from 'lucide-react'
import type { SurprisingFinding, Confidence } from './parse'

interface SurprisingFindingsViewProps {
  caption: string
  findings: SurprisingFinding[]
  emptyMessage?: string
}

const CONFIDENCE_STYLES: Record<Confidence, { chip: string; label: string }> = {
  High: {
    chip: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    label: 'High confidence',
  },
  Medium: {
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    label: 'Medium confidence',
  },
  Low: {
    chip: 'bg-rose-50 text-rose-800 border-rose-200',
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

  return (
    <div className="space-y-5">
      {caption && (
        <p className="text-sm text-gray-500 leading-relaxed max-w-3xl">
          {caption}
        </p>
      )}
      <div className="space-y-4">
        {findings.map((f) => {
          const confStyle = f.confidence ? CONFIDENCE_STYLES[f.confidence] : null
          return (
            <article
              key={f.index}
              className="bg-white rounded-lg border border-gray-200 shadow-sm p-5"
            >
              <div className="flex items-start gap-4">
                {/* Numbered badge — brand-orange circle so the reader
                    can scan the list visually. */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#E07A5F] text-white flex items-center justify-center text-sm font-semibold tabular-nums">
                  {f.index}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-gray-900 leading-snug mb-2">
                    {f.headline}
                  </h3>

                  {/* Interpretation body — rendered via MarkdownRenderer
                      so inline formatting (bold, italics, links) inside
                      the interpretation still renders correctly. The
                      confidence tag has been stripped by the parser so
                      it doesn't appear mid-paragraph.
                      [&_p]:my-0 kills MarkdownRenderer's default paragraph
                      margins so the outer wrapper controls the rhythm —
                      previously they compounded with H3 mb + confidence
                      mt and produced the excess white space the user
                      called out. */}
                  <div className="text-sm text-gray-700 leading-relaxed [&_p]:my-0 [&_p+p]:mt-2">
                    <MarkdownRenderer content={f.interpretation} />
                  </div>

                  {/* Confidence chip — always positioned at the bottom
                      of the card, always visually distinct via color.
                      When evidence is present it renders on its own
                      italic line below the chip. */}
                  {(confStyle || f.evidence) && (
                    <div className="mt-3">
                      {confStyle && (
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border ${confStyle.chip}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                          {confStyle.label}
                        </span>
                      )}
                      {f.evidence && (
                        <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                          <span className="font-medium text-gray-600">Evidence:</span>{' '}
                          {f.evidence}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
