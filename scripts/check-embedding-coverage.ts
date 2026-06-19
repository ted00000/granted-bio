// Embedding coverage health check.
//
// Counts NULL vs total per embedding column across every entity that has
// one. Read-only, cheap (six SELECT COUNT queries), no paid APIs.
//
// Use this to size NULL-embedding drift before deciding what to fill,
// and to validate that recent backfills actually closed the gap.
//
// Output is the same shape we'll eventually surface on the dashboard as
// the per-entity health metric (see DATA_PIPELINE_PLAN.md watch-for
// section).
//
// Usage:
//   npx tsx scripts/check-embedding-coverage.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

interface CheckTarget {
  table: string
  column: string
  label: string
}

// projects.title_embedding and projects.phr_embedding were dropped on
// 2026-06-18 (see migration 20260618_drop_unused_project_embeddings.sql).
// abstract_embedding is a blended vector of title + phr + terms + abstract
// per etl/generate_embeddings_batched.py:108 — the single source of
// per-project semantic signal.
const TARGETS: CheckTarget[] = [
  { table: 'projects', column: 'abstract_embedding', label: 'projects.abstract_embedding' },
  { table: 'publications', column: 'publication_embedding', label: 'publications.publication_embedding' },
  { table: 'patents', column: 'patent_embedding', label: 'patents.patent_embedding' },
  { table: 'clinical_studies', column: 'study_embedding', label: 'clinical_studies.study_embedding' },
]

async function countAll(table: string): Promise<number> {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) throw new Error(`count(${table}): ${error.message}`)
  return count ?? 0
}

async function countNull(table: string, column: string): Promise<number> {
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .is(column, null)
  if (error) throw new Error(`count(${table}.${column} IS NULL): ${error.message}`)
  return count ?? 0
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function padNum(n: number, width: number): string {
  return n.toLocaleString().padStart(width)
}

async function main() {
  console.log('='.repeat(72))
  console.log('Embedding coverage check (read-only)')
  console.log('='.repeat(72))

  // Cache total counts per table so we don't re-query (projects has 3 columns).
  const totals = new Map<string, number>()
  for (const t of new Set(TARGETS.map((t) => t.table))) {
    totals.set(t, await countAll(t))
  }

  console.log()
  console.log(
    pad('Column', 40) + padNum(0, 0).padStart(0) +
      pad('Total', 14) +
      pad('NULL', 14) +
      pad('Coverage', 12)
  )
  console.log('-'.repeat(72))

  const results: { label: string; total: number; nulls: number; pct: number }[] = []

  for (const target of TARGETS) {
    const total = totals.get(target.table) ?? 0
    const nulls = await countNull(target.table, target.column)
    const filled = total - nulls
    const pct = total === 0 ? 0 : (filled / total) * 100
    results.push({ label: target.label, total, nulls, pct })

    const cov = `${pct.toFixed(1)}%`
    console.log(
      pad(target.label, 40) +
        pad(total.toLocaleString(), 14) +
        pad(nulls.toLocaleString(), 14) +
        pad(cov, 12)
    )
  }

  console.log()
  console.log('Summary:')
  const gaps = results.filter((r) => r.nulls > 0)
  if (gaps.length === 0) {
    console.log('  All embedding columns are fully covered. No NULL gaps.')
  } else {
    console.log('  Columns with NULL embeddings (drift):')
    for (const g of gaps) {
      console.log(`    - ${g.label}: ${g.nulls.toLocaleString()} NULL / ${g.total.toLocaleString()} total`)
    }
  }

  const totalNulls = results.reduce((sum, r) => sum + r.nulls, 0)
  console.log(`  Total NULL embeddings across all entities: ${totalNulls.toLocaleString()}`)
  console.log()
  console.log('No DB writes were made.')
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
