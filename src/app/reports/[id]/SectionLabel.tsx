// Shared top-level section label. Renders as a small coral uppercase
// caps tag that sits above each analytical block (Overview, Assessment,
// Evidence, Top Gap Opportunities, etc.). Reserved for TOP-LEVEL
// section labels only — sub-labels (position markers like "Finding N
// of M", tile sub-labels like "Preprint ratio", table column headers)
// keep the muted gray treatment so the coral means something.
//
// Icon prop is intentionally sparse — the coral color already carries
// the "this is a section label" signal, and mixed icon/no-icon labels
// across a page reads as arbitrary. Add an icon only when it earns
// its space semantically (e.g., mapping a specific concept to a
// well-known glyph). In practice: leave it off.

import type { LucideIcon } from 'lucide-react'

interface SectionLabelProps {
  children: React.ReactNode
  icon?: LucideIcon
  /** Rendered as a muted `(N)` suffix — for "Coverage Dimensions (5)" style. */
  count?: number
  /** Bottom margin override; defaults to mb-3 which matches most callers. */
  className?: string
}

export function SectionLabel({
  children,
  icon: Icon,
  count,
  className = 'mb-3',
}: SectionLabelProps) {
  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] font-semibold text-[#E07A5F] uppercase tracking-wider ${className}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />}
      <span>{children}</span>
      {typeof count === 'number' && (
        <span className="text-gray-400 font-medium normal-case tracking-normal">
          ({count})
        </span>
      )}
    </div>
  )
}
