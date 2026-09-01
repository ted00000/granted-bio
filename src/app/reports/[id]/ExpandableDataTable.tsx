'use client'

// Client-side wrapper around DataTable that adds a top-N ↔ all
// toggle plus pagination when the caller has the full sample
// available. Used on the Projects / Organizations / Researchers
// Data pages — they store a curated top-N slice in one column and,
// as of 2026-09-01, the full analyzed sample in a companion column.
//
// Design:
//   * Default view is the top-N (the curated summary), same shape
//     as before this component landed. That preserves the "scoped
//     by default" stance from earlier design work.
//   * When `allRows` is present, a toggle appears in the header
//     row: "Show all N →" flips to a paginated view over allRows;
//     "Show top N ←" flips back. Pagination is client-side because
//     the full sample is already in the RSC payload (100–500 rows
//     is nothing to render).
//   * When `allRows` is null (older reports pre-migration), no
//     toggle is rendered and the table behaves exactly as before.
//
// The parent (a per-type client component like ProjectsTable) owns
// the column definitions since render functions can't cross the
// RSC boundary. This component owns only the state + layout.
// Nothing depends on the row shape, so it's generic over T.

import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { DataTable, type Column } from './DataTable'
import { SectionLabel } from './SectionLabel'

interface ExpandableDataTableProps<T> {
  /** The curated slice (typically top-15 or top-20 by some metric). */
  topRows: T[]
  /** The full analyzed sample. Null for older reports without
   *  the full-sample column populated — the table then behaves
   *  exactly like a plain DataTable of topRows. */
  allRows: T[] | null
  /** Full sample count. Used for the caption + toggle label. May
   *  differ from `allRows?.length` for legacy reports where we
   *  know a count from funding_stats but don't have the array. */
  totalCount: number
  columns: Column<T>[]
  /** Caption shown when viewing the curated top-N slice.
   *  e.g., "Top 20 by Funding". */
  topLabel: string
  /** Caption shown when viewing the paginated full sample.
   *  e.g., "All Projects". */
  expandedLabel: string
  /** Row-key extractor for React reconciliation. */
  rowKey: (row: T) => string
  /** Empty-state copy for the underlying DataTable. */
  emptyMessage?: string
  /** How many rows per paginated "all" page. 25 keeps the page
   *  scannable without paginating too aggressively. */
  pageSize?: number
}

export function ExpandableDataTable<T>({
  topRows,
  allRows,
  totalCount,
  columns,
  topLabel,
  expandedLabel,
  rowKey,
  emptyMessage,
  pageSize = 25,
}: ExpandableDataTableProps<T>) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)

  const canExpand = allRows !== null && allRows.length > topRows.length
  const showAll = expanded && allRows !== null

  const rowsForPage = showAll
    ? allRows.slice(page * pageSize, page * pageSize + pageSize)
    : topRows

  const pageCount = showAll ? Math.ceil(allRows.length / pageSize) : 1
  const shownStart = showAll ? page * pageSize + 1 : 1
  const shownEnd = showAll
    ? Math.min(page * pageSize + pageSize, allRows.length)
    : topRows.length

  return (
    <div className="space-y-4">
      {/* Header row: caption on the left, toggle on the right when
          the full sample is available. */}
      <div className="flex items-baseline justify-between gap-4 px-1 flex-wrap">
        <SectionLabel className="mb-0" count={showAll ? allRows.length : topRows.length}>
          {showAll ? expandedLabel : topLabel}
        </SectionLabel>
        <div className="flex items-center gap-3 text-[12px] text-gray-500">
          {showAll ? (
            <span className="tabular-nums">
              Showing {shownStart.toLocaleString()}–{shownEnd.toLocaleString()} of{' '}
              <span className="text-gray-700 font-medium">{allRows.length.toLocaleString()}</span>
            </span>
          ) : (
            canExpand && (
              <span className="tabular-nums">
                Showing {topRows.length} of{' '}
                <span className="text-gray-700 font-medium">{totalCount.toLocaleString()}</span>
              </span>
            )
          )}
          {canExpand && (
            <button
              type="button"
              onClick={() => {
                setExpanded((v) => !v)
                setPage(0)
              }}
              className="inline-flex items-center gap-1 text-[#E07A5F] hover:text-[#C96A4F] font-medium print:hidden"
            >
              {showAll ? (
                <>
                  <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                  Show top {topRows.length}
                </>
              ) : (
                <>
                  Show all {allRows!.length.toLocaleString()}
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <DataTable
        rows={rowsForPage}
        columns={columns}
        rowKey={rowKey}
        emptyMessage={emptyMessage}
      />

      {/* Pagination — only in expanded mode when more than one page. */}
      {showAll && pageCount > 1 && (
        <div className="flex items-center justify-between gap-4 px-1 flex-wrap print:hidden">
          <div className="text-[12px] text-gray-500 tabular-nums">
            Page {page + 1} of {pageCount}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:text-[#E07A5F] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-gray-600 hover:text-[#E07A5F] disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
