// Embedding coverage health check.
//
// Counts NULL embeddings per entity and classifies them as:
//   - DRIFT: row has embeddable content but no embedding (something we
//            should fill — represents a pipeline gap)
//   - STRUCTURAL: row has no embeddable content (NULL/empty input text),
//            so there's nothing to embed and the NULL is correct.
//
// Read-only, cheap (a handful of SELECT COUNT queries), no paid APIs.
// Same shape we'll surface on the dashboard as the per-entity health
// metric (see DATA_PIPELINE_PLAN.md watch-for section).
//
// Usage:
//   npx tsx scripts/check-embedding-coverage.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

interface CheckTarget {
  table: string
  embeddingColumn: string
  // Field(s) that define "embeddable content." For composite inputs (e.g.,
  // projects = title + phr + terms + abstract), include the most material
  // field — a NULL on this means the row likely has no useful input at all.
  inputField: string
  label: string
}

// projects.title_embedding and projects.phr_embedding were dropped on
// 2026-06-18 (see migration 20260618_drop_unused_project_embeddings.sql).
// abstract_embedding is a blended vector of title + phr + terms + abstract
// per etl/generate_embeddings_batched.py:108 — the single source of
// per-project semantic signal. We use `title` as the embeddability indicator
// because in practice a project with no title has nothing else either.
const TARGETS: CheckTarget[] = [
  {
    table: 'projects',
    embeddingColumn: 'abstract_embedding',
    inputField: 'title',
    label: 'projects.abstract_embedding',
  },
  {
    table: 'publications',
    embeddingColumn: 'publication_embedding',
    inputField: 'pub_title',
    label: 'publications.publication_embedding',
  },
  {
    table: 'patents',
    embeddingColumn: 'patent_embedding',
    inputField: 'patent_title',
    label: 'patents.patent_embedding',
  },
  {
    table: 'clinical_studies',
    embeddingColumn: 'study_embedding',
    inputField: 'study_title',
    label: 'clinical_studies.study_embedding',
  },
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

async function countStructuralNull(
  table: string,
  embeddingColumn: string,
  inputField: string
): Promise<number> {
  // STRUCTURAL = no embedding AND no embeddable input. The PostgREST `or`
  // filter expresses "input field is NULL or empty string."
  const { supabaseAdmin } = await import('../src/lib/supabase')
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .is(embeddingColumn, null)
    .or(`${inputField}.is.null,${inputField}.eq.`)
  if (error) throw new Error(`count structural ${table}.${embeddingColumn}: ${error.message}`)
  return count ?? 0
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

async function main() {
  console.log('='.repeat(80))
  console.log('Embedding coverage check (read-only)')
  console.log('='.repeat(80))

  const totals = new Map<string, number>()
  for (const t of new Set(TARGETS.map((t) => t.table))) {
    totals.set(t, await countAll(t))
  }

  console.log()
  console.log(
    pad('Column', 38) +
      pad('Total', 12) +
      pad('NULL', 10) +
      pad('Drift', 10) +
      pad('Structural', 13) +
      'Coverage'
  )
  console.log('-'.repeat(80))

  const results: {
    label: string
    total: number
    nulls: number
    structural: number
    drift: number
    pct: number
  }[] = []

  for (const target of TARGETS) {
    const total = totals.get(target.table) ?? 0
    const nulls = await countNull(target.table, target.embeddingColumn)
    const structural = await countStructuralNull(
      target.table,
      target.embeddingColumn,
      target.inputField
    )
    const drift = nulls - structural
    const filled = total - nulls
    const pct = total === 0 ? 0 : (filled / total) * 100
    results.push({ label: target.label, total, nulls, structural, drift, pct })

    const cov = `${pct.toFixed(1)}%`
    console.log(
      pad(target.label, 38) +
        pad(total.toLocaleString(), 12) +
        pad(nulls.toLocaleString(), 10) +
        pad(drift.toLocaleString(), 10) +
        pad(structural.toLocaleString(), 13) +
        cov
    )
  }

  console.log()
  console.log('Summary:')

  const drifty = results.filter((r) => r.drift > 0)
  const structuralOnly = results.filter((r) => r.drift === 0 && r.structural > 0)

  if (drifty.length === 0) {
    console.log('  No drift NULLs. Every embeddable row has its embedding.')
  } else {
    console.log('  Columns with DRIFT (embeddable but not embedded — fillable):')
    for (const r of drifty) {
      console.log(
        `    - ${r.label}: ${r.drift.toLocaleString()} drift / ${r.total.toLocaleString()} total`
      )
    }
  }
  if (structuralOnly.length > 0) {
    console.log('  Columns with STRUCTURAL NULLs only (no embeddable input — expected):')
    for (const r of structuralOnly) {
      console.log(
        `    - ${r.label}: ${r.structural.toLocaleString()} structural / ${r.total.toLocaleString()} total`
      )
    }
  }

  const totalDrift = results.reduce((sum, r) => sum + r.drift, 0)
  const totalStructural = results.reduce((sum, r) => sum + r.structural, 0)
  console.log(`  Total drift across all entities:      ${totalDrift.toLocaleString()}`)
  console.log(`  Total structural across all entities: ${totalStructural.toLocaleString()}`)
  console.log()
  console.log('No DB writes were made.')
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
