// Bespoke render for the Field Maturity Analysis page. Uses the
// structured agent_outputs.fieldMaturity shape (see types.ts
// FieldMaturityAssessment) rather than parsing markdown. Content:
//   - Tier hero: 4-step nascent/emerging/maturing/established progress
//     indicator with the current tier highlighted
//   - TRL estimate + benchmark comparison in a compact info row
//   - Maturity narrative (rendered via MarkdownRenderer so inline
//     confidence chips + evidence panels light up automatically)
//   - Evidence summary as a 3-tile grid (preprint / trials / patents)
//   - Strategic implications block

import { MarkdownRenderer } from '../MarkdownRenderer'
import { SectionLabel } from '../SectionLabel'
import { Gauge, FileText, FlaskConical, Award, Target } from 'lucide-react'

type MaturityTier = 'nascent' | 'emerging' | 'maturing' | 'established'

interface FieldMaturity {
  trlEstimate: string
  maturityNarrative: string
  benchmarkComparison?: string
  evidenceSummary: {
    preprintRatio: string
    trialProgression: string
    patentActivity: string
  }
  strategicImplications?: string
  overallAssessment: MaturityTier
}

const TIER_ORDER: MaturityTier[] = ['nascent', 'emerging', 'maturing', 'established']

// Ascending progression colors — dim to bold as the field matures.
// Each tier gets its own accent so the reader can associate the tier
// with a color without having to re-read the label.
const TIER_STYLES: Record<MaturityTier, { label: string; dot: string; bar: string; chip: string }> = {
  nascent:     { label: 'Nascent',     dot: 'bg-rose-500',    bar: 'bg-rose-400',    chip: 'bg-rose-50 text-rose-800' },
  emerging:    { label: 'Emerging',    dot: 'bg-amber-500',   bar: 'bg-amber-400',   chip: 'bg-amber-50 text-amber-800' },
  maturing:    { label: 'Maturing',    dot: 'bg-sky-500',     bar: 'bg-sky-400',     chip: 'bg-sky-50 text-sky-800' },
  established: { label: 'Established', dot: 'bg-emerald-500', bar: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-800' },
}

export function FieldMaturityView({ fieldMaturity }: { fieldMaturity: FieldMaturity | null }) {
  if (!fieldMaturity) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <Gauge className="w-6 h-6 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Field maturity was not computed for this analysis.
        </p>
      </div>
    )
  }

  const currentTierIdx = TIER_ORDER.indexOf(fieldMaturity.overallAssessment)
  const currentStyle = TIER_STYLES[fieldMaturity.overallAssessment]

  return (
    <div className="space-y-5">
      {/* Tier hero — 4-step progression + TRL estimate + benchmark */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className={`h-1 ${currentStyle.bar}`} />
        <div className="px-6 py-5">
          <SectionLabel>Maturity Tier</SectionLabel>
          <div className="flex items-center gap-3 mb-5">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full ${currentStyle.chip}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${currentStyle.dot}`} />
              {currentStyle.label}
            </span>
          </div>
          {/* 4-dot progression — filled dots up to and including current */}
          <div className="flex items-center gap-2 mb-4">
            {TIER_ORDER.map((tier, i) => {
              const isActive = i <= currentTierIdx
              const isCurrent = i === currentTierIdx
              return (
                <div key={tier} className="flex-1 flex items-center">
                  <div className={`flex-1 h-1.5 rounded-full ${isActive ? TIER_STYLES[tier].bar : 'bg-gray-100'}`} />
                  <div
                    className={`ml-2 w-3 h-3 rounded-full ring-2 ring-white ${
                      isCurrent ? currentStyle.dot : isActive ? TIER_STYLES[tier].bar : 'bg-gray-200'
                    }`}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">
            {TIER_ORDER.map((tier) => (
              <span
                key={tier}
                className={tier === fieldMaturity.overallAssessment ? 'text-gray-800' : ''}
              >
                {TIER_STYLES[tier].label}
              </span>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                TRL Estimate
              </div>
              <div className="text-[15px] text-gray-900 font-medium">
                {fieldMaturity.trlEstimate}
              </div>
            </div>
            {fieldMaturity.benchmarkComparison && (
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Historical Benchmark
                </div>
                <div className="text-[15px] text-gray-700 leading-snug">
                  {fieldMaturity.benchmarkComparison}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Narrative — confidence chips + evidence panels auto-extracted
          by MarkdownRenderer since the tags appear in prose. */}
      {fieldMaturity.maturityNarrative && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel>Assessment</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={fieldMaturity.maturityNarrative} compact />
          </div>
        </section>
      )}

      {/* Evidence grid — three signals the LLM's assessment is grounded
          in. Each tile has its own icon so at-a-glance scanning maps
          the signal (paper vs. flask vs. award) to its content.
          Tile values pass through MarkdownRenderer so any inline
          `**Confidence: X**` + `- Evidence: ...` embedded in the LLM's
          text gets extracted into the shared chip + evidence-panel
          treatment instead of rendering as literal markdown syntax. */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
        <SectionLabel className="mb-4">Evidence</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: FileText,      label: 'Preprint ratio',     value: fieldMaturity.evidenceSummary.preprintRatio },
            { icon: FlaskConical,  label: 'Trial progression',  value: fieldMaturity.evidenceSummary.trialProgression },
            { icon: Award,         label: 'Patent activity',    value: fieldMaturity.evidenceSummary.patentActivity },
          ].map((cell) => {
            const Icon = cell.icon
            return (
              <div key={cell.label} className="bg-gray-50 rounded-md p-4 border border-gray-100">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                  {cell.label}
                </div>
                <div className="text-[14px] text-gray-700 leading-relaxed [&_p]:my-0 [&_p+p]:mt-2">
                  <MarkdownRenderer content={cell.value} compact />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Strategic implications — the "so what" for the reader. */}
      {fieldMaturity.strategicImplications && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel icon={Target}>Strategic Implications</SectionLabel>
          <div className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <MarkdownRenderer content={fieldMaturity.strategicImplications} compact />
          </div>
        </section>
      )}
    </div>
  )
}
