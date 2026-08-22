// Shared table component for the Data section pages (Projects,
// Trials, Patents, Publications, Organizations, Researchers). Matches
// the design vocab used by MarkdownRenderer's inline table treatment
// (uppercase caps column headers, hairline row separators, subtle
// hover, generous padding) so tables look identical whether they
// come from markdown or from this structured render.
//
// Each page provides its own Column definitions — no per-page copy
// of table markup or styling.

import type { ReactNode } from 'react'

export interface Column<T> {
  /** Display label rendered in the uppercase-caps header row. */
  label: string
  /** Text alignment for both header and body cells. */
  align?: 'left' | 'right' | 'center'
  /** Optional column-level width via Tailwind class (e.g. 'w-24'). */
  widthClass?: string
  /** Render function for the body cell. Return a ReactNode. */
  render: (row: T, index: number) => ReactNode
  /** Optional extra Tailwind classes on the body cell (mono, tabular, etc.). */
  cellClass?: string
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  /** Message shown when the row array is empty. */
  emptyMessage?: string
  /** Optional key extractor — defaults to array index. */
  rowKey?: (row: T, index: number) => string
}

function alignClass(align: Column<unknown>['align']): string {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

export function DataTable<T>({
  rows,
  columns,
  emptyMessage = 'No data available.',
  rowKey,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider ${alignClass(col.align)} ${col.widthClass ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors"
              >
                {columns.map((col, ci) => (
                  <td
                    key={ci}
                    className={`px-4 py-3 text-[14px] text-gray-700 align-top ${alignClass(col.align)} ${col.cellClass ?? ''}`}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
