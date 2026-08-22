import { DataTable, type Column } from '../DataTable'
import { SectionLabel } from '../SectionLabel'

interface Publication {
  pmid: string
  publication_title: string | null
  journal: string | null
  publication_date: string | null
  pub_year: number | null
  authors: string | null
}

interface CuratedPublication {
  pmid: string
  title: string
  journal: string | null
  year: number | null
  significance: string
  keyFinding: string
}

interface PublicationsViewProps {
  publications: Publication[]
  curated?: CuratedPublication[]
  totalUniqueJournals?: number
  /** Maximum publications rendered in the main table. Everything
   *  beyond this is dropped from render but the caption shows the
   *  full count so the reader knows. */
  displayLimit?: number
}

function formatAuthors(authors: string | null): string {
  if (!authors) return '—'
  const list = authors.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return '—'
  if (list.length === 1) return list[0]
  if (list.length === 2) return list.join(', ')
  return `${list[0]}, ${list[1]} +${list.length - 2}`
}

function bestYear(p: Publication): string {
  if (p.pub_year) return String(p.pub_year)
  if (p.publication_date) {
    const y = p.publication_date.match(/\d{4}/)?.[0]
    if (y) return y
  }
  return '—'
}

export function PublicationsView({
  publications,
  curated,
  totalUniqueJournals,
  displayLimit = 100,
}: PublicationsViewProps) {
  const total = publications.length
  const shown = Math.min(total, displayLimit)
  const isTruncated = total > shown
  const rows = publications.slice(0, shown)

  const columns: Column<Publication>[] = [
    {
      label: 'Publication',
      widthClass: 'w-2/5',
      render: (p) => (
        <div>
          <div className="text-gray-900 font-medium leading-snug mb-0.5">
            {p.publication_title || '(No title)'}
          </div>
          <div className="text-[11px] text-gray-400 tabular-nums">PMID {p.pmid}</div>
        </div>
      ),
    },
    {
      label: 'Authors',
      render: (p) => (
        <span className="text-gray-700 text-[13px] leading-snug block">
          {formatAuthors(p.authors)}
        </span>
      ),
    },
    {
      label: 'Journal',
      render: (p) => (
        <span className="text-gray-600 text-[13px] leading-snug block italic">
          {p.journal || '—'}
        </span>
      ),
    },
    {
      label: 'Year',
      align: 'right',
      cellClass: 'tabular-nums text-gray-600',
      render: (p) => bestYear(p),
    },
  ]

  return (
    <div className="space-y-4">
      {/* Curated "must-read" publications up top when present */}
      {curated && curated.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm px-6 py-5">
          <SectionLabel className="mb-3" count={curated.length}>
            Must-Read Publications
          </SectionLabel>
          <div className="space-y-3">
            {curated.map((c) => (
              <div key={c.pmid} className="pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
                <div className="text-sm font-medium text-gray-900 leading-snug mb-1">
                  {c.title}
                </div>
                <div className="text-[11px] text-gray-400 tabular-nums mb-2">
                  {c.journal ?? '—'} {c.year ? `· ${c.year}` : ''} · PMID {c.pmid}
                </div>
                <p className="text-[13px] text-gray-700 leading-relaxed mb-1.5">
                  {c.significance}
                </p>
                <p className="text-[12px] text-gray-500 italic leading-relaxed">
                  Key finding: {c.keyFinding}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-baseline justify-between px-1">
        <SectionLabel className="mb-0" count={total}>
          {isTruncated ? `First ${shown} by recency` : 'All Publications'}
        </SectionLabel>
        <div className="text-[12px] text-gray-500 tabular-nums">
          {isTruncated && (
            <>
              Showing {shown} of <span className="text-gray-700 font-medium">{total}</span>
              {' · '}
            </>
          )}
          {typeof totalUniqueJournals === 'number' && (
            <>
              <span className="text-gray-700 font-medium">{totalUniqueJournals}</span> unique journals
            </>
          )}
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(p) => p.pmid}
        emptyMessage="No publications linked to this analysis sample."
      />
    </div>
  )
}
