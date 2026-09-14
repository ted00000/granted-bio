// Collapsed methodology disclosure that renders above ranked
// aggregation tables (Researchers, Organizations). Discloses the
// two aggregation choices readers can't infer from the table:
//   1. Entity identity is a name-string dedup, not a canonical ID.
//   2. Funding is split evenly across co-listed entities per grant.
//
// Why this exists: technical buyers who check a Top-N list against
// people/orgs they know will see split identities (same person under
// two name renderings) or missing entries (funding fractured across
// variants) or share-mis-attributions on co-PI grants. Making the
// method visible neutralizes the "you didn't disclose" credibility
// hit even when the underlying data can't be perfectly cleaned up.
//
// Adjustable per-surface via the `variant` prop; the co-PI split
// clause only applies to researchers (organizations don't share
// per-grant funding across each other).
//
// Marker attribute `data-aggregation-caveat` lets the report linter
// detect the presence of this component when checking narrative
// sections that reference PI/org rankings — see
// src/lib/reports/lint-report.ts, rule `require-aggregation-caveat`.

import { Info } from 'lucide-react'

interface AggregationMethodologyNoteProps {
  variant: 'researcher' | 'organization'
}

export function AggregationMethodologyNote({
  variant,
}: AggregationMethodologyNoteProps) {
  const entityLabel = variant === 'researcher' ? 'researcher' : 'organization'

  return (
    <div
      data-aggregation-caveat={variant}
      className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600"
    >
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-gray-700 marker:hidden">
          <Info className="h-3.5 w-3.5 text-gray-400" strokeWidth={1.75} />
          <span>How this ranking was aggregated</span>
          <span className="ml-auto text-[10px] text-gray-400 group-open:hidden">
            expand
          </span>
        </summary>
        <div className="mt-2 space-y-2 pl-5">
          <p>
            <strong>{entityLabel === 'researcher' ? 'PI identity' : 'Organization identity'}</strong>{' '}
            is derived from the source {entityLabel === 'researcher' ? '`pi_names`' : '`org_name`'}{' '}
            string on each NIH-funded project. Names are normalized and
            deduplicated by string comparison — there is no canonical{' '}
            {entityLabel} ID in the underlying NIH data. The same{' '}
            {entityLabel === 'researcher' ? 'person' : 'organization'}{' '}
            appearing under different renderings (initials, punctuation,
            suffixes) may resolve as more than one row; conversely,
            distinct entities sharing a common rendering may collapse.
          </p>
          {variant === 'researcher' && (
            <p>
              <strong>Funding attribution</strong> is split evenly across
              every PI listed on a grant. NIH distinguishes a Contact PI
              from Multi-PIs in the grant data, but the source we ingest
              does not preserve that role, so we do not weight by it.
              Grants with a single listed PI are unaffected.
            </p>
          )}
          <p className="text-[11px] italic text-gray-500">
            Rankings therefore reflect the shape of NIH-linked activity
            rather than a definitive top-{entityLabel} count. Use them
            as directional context, not as a scoreboard.
          </p>
        </div>
      </details>
    </div>
  )
}
