'use client'

// Client component now — the phase distribution chips at the top are
// interactive filters (click to filter the table below, click again to
// clear). Converted from a server async component 2026-09-21; the
// server-only inShare context is now resolved in page.tsx and passed
// down as a prop.

import { useState, useMemo } from 'react'
import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'
import { InternalLink } from '../EntityLink'
import { detailHref } from '@/lib/reports/share-nav'

interface Trial {
  nct_id: string
  study_title: string
  phase: string | null
  study_type: string | null
  study_status: string | null
  lead_sponsor: string | null
  enrollment_count: number | null
}

interface TrialsViewProps {
  trials: Trial[]
  byPhase?: Record<string, number>
  byStatus?: Record<string, number>
  /** Resolved server-side in page.tsx via getShareContextFromHeaders. */
  inShare: boolean
}

// Color-code the phase chip using the standard clinical-trial
// progression semantic (Phase 4 = post-market, most mature).
// Works against both the raw enum ("PHASE1") and the display form
// ("Phase 1") — both contain the digit — so it doesn't matter
// whether the caller passes the pre- or post-formatPhase value.
function phaseStyle(phase: string | null): string {
  if (!phase) return 'bg-gray-100 text-gray-600'
  const p = phase.toLowerCase()
  if (p.includes('4')) return 'bg-emerald-50 text-emerald-800'
  if (p.includes('3')) return 'bg-sky-50 text-sky-800'
  if (p.includes('2')) return 'bg-amber-50 text-amber-800'
  if (p.includes('1')) return 'bg-rose-50 text-rose-800'
  return 'bg-gray-100 text-gray-600'
}

function statusStyle(status: string | null): string {
  if (!status) return 'text-gray-500'
  const s = status.toLowerCase()
  if (s.includes('completed')) return 'text-emerald-700'
  if (s.includes('recruit') || s.includes('active') || s.includes('enroll')) return 'text-sky-700'
  if (s.includes('terminated') || s.includes('withdrawn') || s.includes('suspend')) return 'text-rose-700'
  return 'text-gray-600'
}

// ClinicalTrials.gov API v2 stores phase as an enum string
// (PHASE1 / PHASE2 / PHASE3 / PHASE4 / EARLY_PHASE1 / NA / null).
// Render as a human-readable label. Nulls fall back to studyType
// context: OBSERVATIONAL trials aren't phase-based so "Observational"
// is more informative than a dash; anything else with no phase is
// "Not reported."
function formatPhase(phase: string | null, studyType: string | null): string {
  if (!phase || phase.trim() === '') {
    if (studyType && studyType.toUpperCase() === 'OBSERVATIONAL') return 'Observational'
    return 'Not reported'
  }
  // Normalize whitespace / underscores / case so PHASE1 / phase 1 /
  // Phase_1 all resolve to the same lookup key.
  const key = phase.toUpperCase().replace(/[_\s]/g, '')
  const map: Record<string, string> = {
    PHASE1: 'Phase 1',
    PHASE2: 'Phase 2',
    PHASE3: 'Phase 3',
    PHASE4: 'Phase 4',
    EARLYPHASE1: 'Early Phase 1',
    PHASE1PHASE2: 'Phase 1/2',
    PHASE2PHASE3: 'Phase 2/3',
    NA: 'N/A',
    NOTAPPLICABLE: 'N/A',
  }
  // Fall through: unknown enum from a future ClinicalTrials.gov
  // release — pass through as-is rather than blanking the cell.
  return map[key] ?? phase
}

// ClinicalTrials.gov status is also SCREAMING_SNAKE (RECRUITING,
// NOT_YET_RECRUITING, ACTIVE_NOT_RECRUITING, COMPLETED, etc.).
// Some rows store it with spaces ("NOT YET RECRUITING") — handle
// both by normalizing underscores → spaces first. Special-case the
// two comma-natural forms ("Active, not recruiting", "Enrolling by
// invitation") for cleaner English.
function formatStatus(status: string | null): string {
  if (!status || status.trim() === '') return '—'
  const cleaned = status.toLowerCase().replace(/_/g, ' ').trim()
  const specialCase: Record<string, string> = {
    'active not recruiting': 'Active, not recruiting',
    'enrolling by invitation': 'Enrolling by invitation',
    'not yet recruiting': 'Not yet recruiting',
    'unknown status': 'Unknown status',
    'no longer available': 'No longer available',
    'temporarily not available': 'Temporarily not available',
    'approved for marketing': 'Approved for marketing',
  }
  if (specialCase[cleaned]) return specialCase[cleaned]
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function TrialsView({ trials, byPhase, byStatus, inShare }: TrialsViewProps) {
  // Phase filter state. null = no filter, all trials shown. When a chip
  // is clicked, the table below is filtered to trials that resolve to
  // that same phase label via formatPhase (which is the same normalization
  // used to build byPhase, so the label the user clicks matches).
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null)

  const filteredTrials = useMemo(() => {
    if (!phaseFilter) return trials
    return trials.filter((t) => formatPhase(t.phase, t.study_type) === phaseFilter)
  }, [trials, phaseFilter])

  const total = filteredTrials.length

  const columns: Column<Trial>[] = [
    {
      label: 'Study',
      widthClass: 'w-2/5',
      render: (t) => (
        <div>
          <InternalLink
            href={detailHref(`/trial/${t.nct_id}`, inShare)}
            className="text-gray-900 font-medium leading-snug block mb-0.5"
          >
            {t.study_title}
          </InternalLink>
          <div className="text-[11px] text-gray-400 tabular-nums">{t.nct_id}</div>
        </div>
      ),
    },
    {
      label: 'Phase',
      render: (t) => {
        const label = formatPhase(t.phase, t.study_type)
        // Observational / Not reported / N/A all render as a neutral
        // text tag (no colored chip) so the eye still catches the real
        // phase chips easily.
        const isChip =
          label !== 'Observational' && label !== 'Not reported' && label !== 'N/A'
        if (!isChip) {
          return <span className="text-[12px] text-gray-500">{label}</span>
        }
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded ${phaseStyle(label)}`}
          >
            {label}
          </span>
        )
      },
    },
    {
      label: 'Status',
      render: (t) => (
        <span className={`text-[13px] ${statusStyle(t.study_status)}`}>
          {formatStatus(t.study_status)}
        </span>
      ),
    },
    {
      label: 'Sponsor',
      render: (t) => (
        <span className="text-gray-700 text-[13px] leading-snug block">{t.lead_sponsor || '—'}</span>
      ),
    },
    {
      label: 'Enroll',
      align: 'right',
      cellClass: 'tabular-nums text-gray-700',
      render: (t) => (t.enrollment_count != null ? t.enrollment_count.toLocaleString() : '—'),
    },
  ]

  // Phase distribution mini-summary above the table. Sorted by count
  // desc for consistent visual weight.
  const phaseSummary = byPhase
    ? Object.entries(byPhase)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="space-y-4">
      {phaseSummary.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel className="mb-0">Distribution — click to filter</SectionLabel>
            {phaseFilter && (
              <button
                type="button"
                onClick={() => setPhaseFilter(null)}
                className="text-[11px] text-gray-500 hover:text-[#E07A5F] transition-colors underline decoration-dotted underline-offset-2"
              >
                Clear filter
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {phaseSummary.map(([phase, n]) => {
              const active = phaseFilter === phase
              // Base style is the phase's color; active adds a ring for
              // the currently-selected filter. Inactive chips (when a
              // different filter is active) dim to signal they're not
              // the current selection but are still clickable.
              const chipBase = phaseStyle(phase)
              const inactive = phaseFilter !== null && !active
              return (
                <button
                  key={phase}
                  type="button"
                  onClick={() => setPhaseFilter(active ? null : phase)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition ${chipBase} ${
                    active ? 'ring-2 ring-offset-1 ring-gray-900' : 'hover:ring-1 hover:ring-gray-400'
                  } ${inactive ? 'opacity-50' : ''}`}
                  title={active ? `Clear ${phase} filter` : `Filter to ${phase} trials only`}
                >
                  {phase}
                  <span className="text-[11px] opacity-70 tabular-nums">{n}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="flex items-baseline justify-between px-1 gap-3 flex-wrap">
        <SectionLabel className="mb-0" count={total}>
          {phaseFilter ? `${phaseFilter} Trials` : 'Clinical Trials'}
        </SectionLabel>
        <div className="text-[12px] text-gray-500 tabular-nums">
          {byStatus && !phaseFilter && (() => {
            const active = Object.entries(byStatus)
              .filter(([s]) => /recruit|active|enroll|not.yet/i.test(s))
              .reduce((sum, [, n]) => sum + n, 0)
            const done = Object.entries(byStatus)
              .filter(([s]) => /complet/i.test(s))
              .reduce((sum, [, n]) => sum + n, 0)
            const dead = Object.entries(byStatus)
              .filter(([s]) => /terminat|withdrawn|suspend/i.test(s))
              .reduce((sum, [, n]) => sum + n, 0)
            return (
              <>
                <span className="text-sky-700 font-medium">{active}</span> active ·{' '}
                <span className="text-emerald-700 font-medium">{done}</span> completed ·{' '}
                <span className="text-rose-700 font-medium">{dead}</span> stopped
              </>
            )
          })()}
        </div>
      </div>
      <DataTable
        rows={filteredTrials}
        columns={columns}
        rowKey={(t) => t.nct_id}
        emptyMessage={
          phaseFilter
            ? `No ${phaseFilter} trials in this analysis sample.`
            : 'No clinical trials linked to this analysis sample.'
        }
      />
    </div>
  )
}
