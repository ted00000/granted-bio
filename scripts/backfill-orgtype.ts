/**
 * Backfill script for the org_type misclassification bug.
 *
 * Target: rows where `funding_mechanism='Non-SBIR/STTR'` AND
 * `org_type='company'`. These are the rows the pre-fix
 * `determine_org_type` misclassified because it substring-matched
 * "sbir" inside "non-sbir/sttr". At time of authoring this script:
 * ~30,109 rows in this bucket.
 *
 * Approach: reproduce the fixed classifier logic in TypeScript exactly
 * so the backfill matches what a fresh ingest would produce. For each
 * target row, run the classifier and update `org_type` to the correct
 * value. Only touches rows where the classification changes; skips
 * rows where the classifier already agrees (defensive — should be
 * zero given the target predicate, but no-ops are cheap).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-orgtype.ts --dry-run   # preview
 *   npx tsx --env-file=.env.local scripts/backfill-orgtype.ts             # apply
 */

import { supabaseAdmin } from '../src/lib/supabase'

// Reproduce etl/process_projects.py:determine_org_type exactly.
const COMPANY_WORDS = ['inc', 'llc', 'corp', 'ltd', 'company', 'technologies', 'therapeutics', 'biosciences', 'biotech']
const UNIVERSITY_WORDS = ['university', 'college']
const UNIVERSITY_PHRASES = ['institute of technology', 'school of']
const HOSPITAL_WORDS = ['hospital', 'clinic']
const HOSPITAL_PHRASES = ['medical center', 'health system']
const RESEARCH_PHRASES = ['research institute', 'research foundation', 'research center']

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPANY_RE = new RegExp(`\\b(?:${COMPANY_WORDS.map(escape).join('|')})\\b`, 'i')
const COMPANY_ABBREV_RE = /\bco\./i
const UNIVERSITY_RE = new RegExp(
  `\\b(?:${UNIVERSITY_WORDS.map(escape).join('|')})\\b|${UNIVERSITY_PHRASES.map(escape).join('|')}`,
  'i',
)
const HOSPITAL_RE = new RegExp(
  `\\b(?:${HOSPITAL_WORDS.map(escape).join('|')})\\b|${HOSPITAL_PHRASES.map(escape).join('|')}`,
  'i',
)
const RESEARCH_RE = new RegExp(RESEARCH_PHRASES.map(escape).join('|'), 'i')
const SBIR_RE = /(?<!non-)(?<!non )\b(?:sbir|sttr)\b/i

type OrgType = 'university' | 'hospital' | 'research_institute' | 'company' | 'other'

function determineOrgType(name: string | null, funding: string | null): OrgType {
  const n = name ?? ''
  const f = funding ?? ''
  if (UNIVERSITY_RE.test(n)) return 'university'
  if (HOSPITAL_RE.test(n)) return 'hospital'
  if (RESEARCH_RE.test(n)) return 'research_institute'
  if (COMPANY_RE.test(n) || COMPANY_ABBREV_RE.test(n)) return 'company'
  if (SBIR_RE.test(f)) return 'company'
  return 'other'
}

interface Row {
  id: string
  org_name: string | null
  funding_mechanism: string | null
  org_type: string | null
}

async function fetchTargetPage(pageSize: number, afterId: string | null): Promise<Row[]> {
  // Id-cursor pagination. Fetch rows with id > afterId, ordered
  // ascending, capped at pageSize. Rows that we UPDATE and drop out of
  // the filter are already behind the cursor and never re-scanned;
  // rows that stay in the filter (legitimate companies with
  // Non-SBIR/STTR grants) are ALSO behind the cursor after we advance,
  // so we don't re-scan them either. Correct forward-only progress
  // through the predicate set regardless of how many updates land.
  //
  // Safely resumable: kill mid-run and re-run with the same predicate.
  // Rows that were already updated are out of the filter; the fresh
  // run starts at afterId=null and picks up the remaining ones.
  let query = supabaseAdmin
    .from('projects')
    .select('id, org_name, funding_mechanism, org_type')
    .eq('funding_mechanism', 'Non-SBIR/STTR')
    .eq('org_type', 'company')
    .order('id', { ascending: true })
    .limit(pageSize)
  if (afterId !== null) query = query.gt('id', afterId)
  const { data, error } = await query
  if (error) throw new Error(`fetch afterId=${afterId}: ${error.message}`)
  return (data ?? []) as Row[]
}

async function updateBatch(updates: Array<{ id: string; org_type: OrgType }>): Promise<number> {
  // A single-row UPDATE against the projects table takes ~800ms
  // (likely trigger/audit overhead), so batched UPDATE ... WHERE id IN
  // (...) hits the Supabase statement_timeout even at 10 rows. Instead
  // we issue single-row updates concurrently — throughput scales with
  // concurrency, not batch size, and no individual statement gets
  // near the timeout.
  const CONCURRENCY = 30
  let applied = 0
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const slice = updates.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      slice.map(async (u) => {
        const { error } = await supabaseAdmin
          .from('projects')
          .update({ org_type: u.org_type })
          .eq('id', u.id)
        if (error) {
          console.warn(`  update failed for id=${u.id}: ${error.message}`)
          return 0
        }
        return 1
      }),
    )
    applied += results.reduce<number>((s, n) => s + n, 0)
  }
  return applied
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY'}`)

  const pageSize = 500
  let totalScanned = 0
  let totalChanged = 0
  let totalUnchanged = 0
  const changesByNewType: Record<string, number> = {}
  const sampleChanges: Array<{ id: string; org_name: string; before: string; after: string }> = []
  let cursor: string | null = null

  while (true) {
    const page = await fetchTargetPage(pageSize, cursor)
    if (page.length === 0) break

    const updates: Array<{ id: string; org_type: OrgType }> = []
    for (const row of page) {
      totalScanned++
      const newType = determineOrgType(row.org_name, row.funding_mechanism)
      if (newType === row.org_type) {
        totalUnchanged++
        continue
      }
      updates.push({ id: row.id, org_type: newType })
      totalChanged++
      changesByNewType[newType] = (changesByNewType[newType] ?? 0) + 1
      if (sampleChanges.length < 15) {
        sampleChanges.push({
          id: row.id,
          org_name: row.org_name ?? '',
          before: row.org_type ?? 'null',
          after: newType,
        })
      }
    }

    if (updates.length > 0 && !dryRun) {
      const applied = await updateBatch(updates)
      if (applied !== updates.length) {
        console.warn(`  batch: expected ${updates.length} updates, applied ${applied}`)
      }
    }

    cursor = page[page.length - 1].id
    console.log(`  scanned ${totalScanned}, changed ${totalChanged}, unchanged ${totalUnchanged}`)
  }

  console.log('\n=== Summary ===')
  console.log(`Scanned:   ${totalScanned}`)
  console.log(`Changed:   ${totalChanged}`)
  console.log(`Unchanged: ${totalUnchanged}`)
  console.log(`\nChanges by new org_type:`)
  for (const [t, n] of Object.entries(changesByNewType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${n}`)
  }
  console.log(`\nSample changes:`)
  for (const s of sampleChanges) {
    console.log(`  [id=${s.id}] "${s.org_name}"   ${s.before} → ${s.after}`)
  }
  if (dryRun) {
    console.log(`\nDRY RUN — re-run without --dry-run to apply.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
