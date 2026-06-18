// Diff an ExPORTER ClinicalStudies.csv against the live `clinical_studies`
// DB table. Read-only — touches no entity tables, calls no paid APIs.
//
// Usage:
//   npx tsx scripts/diff-clinical-studies.ts <path-to-ClinicalStudies.csv>
//
// Outputs three counts plus samples:
//   - new      : composite (nct_id, project_number) in CSV, not in DB
//   - changed  : composite in both, but study_status or study_title differs
//   - orphan   : composite in DB, not in CSV (NIH probably didn't drop it —
//                more likely a Core Project Number formatting drift)
//
// Run this BEFORE ingesting the all-time ClinicalStudies.csv. If new + changed
// is small, ingest only that slice instead of upserting hundreds of thousands
// of unchanged rows. See docs/DATA_SOURCE_PLAYBOOKS.md (Source 6).

import { config } from 'dotenv'
config({ path: '.env.local' })

import * as fs from 'fs'
import Papa from 'papaparse'

interface CsvRow {
  nct_id: string
  project_number: string
  study_status: string
  study_title: string
}

interface DbRow {
  nct_id: string
  project_number: string
  study_status: string | null
  study_title: string | null
}

function compositeKey(nct: string, proj: string): string {
  return `${nct}|${proj}`
}

function readCsv(path: string): Map<string, CsvRow> {
  console.log(`Reading CSV: ${path}`)
  if (!fs.existsSync(path)) {
    console.error(`File not found: ${path}`)
    process.exit(1)
  }
  const content = fs.readFileSync(path, 'utf-8')

  // Papa parses synchronously when given a string.
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  if (parsed.errors.length > 0) {
    console.warn(`  CSV parser logged ${parsed.errors.length} non-fatal errors (sample):`)
    for (const err of parsed.errors.slice(0, 3)) {
      console.warn(`    row ${err.row}: ${err.message}`)
    }
  }

  const map = new Map<string, CsvRow>()
  let skippedNoKey = 0

  for (const row of parsed.data) {
    const nct = (row['ClinicalTrials.gov ID'] || '').trim()
    const proj = (row['Core Project Number'] || '').trim()
    if (!nct || !proj) {
      skippedNoKey++
      continue
    }
    // In-CSV duplicate composite keys collapse to last-write-wins — the
    // loader's seen_ncts set in process_clinical.py does the same.
    map.set(compositeKey(nct, proj), {
      nct_id: nct,
      project_number: proj,
      study_status: (row['Study Status'] || '').trim(),
      study_title: (row['Study'] || '').trim(),
    })
  }

  console.log(
    `  CSV: ${parsed.data.length} rows parsed → ${map.size} unique composite keys (${skippedNoKey} skipped: missing key field)`
  )
  return map
}

async function readDb(): Promise<Map<string, DbRow>> {
  console.log('Reading clinical_studies from DB...')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const map = new Map<string, DbRow>()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, project_number, study_status, study_title')
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error(`DB query failed at offset ${offset}:`, error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (!row.nct_id || !row.project_number) continue
      map.set(compositeKey(row.nct_id, row.project_number), {
        nct_id: row.nct_id,
        project_number: row.project_number,
        study_status: row.study_status,
        study_title: row.study_title,
      })
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  console.log(`  DB: ${map.size} unique composite keys`)
  return map
}

function normalize(s: string | null | undefined): string {
  return (s || '').trim()
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/diff-clinical-studies.ts <path-to-ClinicalStudies.csv>')
    process.exit(1)
  }

  console.log('='.repeat(64))
  console.log('Clinical Studies Diff — CSV vs DB (read-only)')
  console.log('='.repeat(64))

  const [csvMap, dbMap] = await Promise.all([
    Promise.resolve(readCsv(csvPath)),
    readDb(),
  ])

  const newRows: CsvRow[] = []
  const changedRows: { csv: CsvRow; db: DbRow; reasons: string[] }[] = []
  const orphanRows: DbRow[] = []

  for (const [key, csvRow] of csvMap) {
    const dbRow = dbMap.get(key)
    if (!dbRow) {
      newRows.push(csvRow)
      continue
    }
    const reasons: string[] = []
    if (normalize(dbRow.study_status) !== normalize(csvRow.study_status)) {
      reasons.push(`status: "${normalize(dbRow.study_status)}" → "${normalize(csvRow.study_status)}"`)
    }
    if (normalize(dbRow.study_title) !== normalize(csvRow.study_title)) {
      reasons.push('title changed')
    }
    if (reasons.length > 0) {
      changedRows.push({ csv: csvRow, db: dbRow, reasons })
    }
  }

  for (const [key, dbRow] of dbMap) {
    if (!csvMap.has(key)) orphanRows.push(dbRow)
  }

  const matchedUnchanged = csvMap.size - newRows.length - changedRows.length

  console.log()
  console.log('='.repeat(64))
  console.log('Results')
  console.log('='.repeat(64))
  console.log(`New      (in CSV, not in DB)       : ${newRows.length.toLocaleString()}`)
  console.log(`Changed  (composite matches, fields differ): ${changedRows.length.toLocaleString()}`)
  console.log(`Orphan   (in DB, not in CSV)       : ${orphanRows.length.toLocaleString()}`)
  console.log(`Matched unchanged                  : ${matchedUnchanged.toLocaleString()}`)

  const SAMPLE = 5

  if (newRows.length > 0) {
    console.log(`\nSample new (first ${Math.min(SAMPLE, newRows.length)}):`)
    for (const r of newRows.slice(0, SAMPLE)) {
      const title = (r.study_title || '').slice(0, 72)
      console.log(`  - ${r.nct_id} ↔ ${r.project_number}  [${r.study_status || '–'}]  ${title}`)
    }
  }

  if (changedRows.length > 0) {
    console.log(`\nSample changed (first ${Math.min(SAMPLE, changedRows.length)}):`)
    for (const { csv, reasons } of changedRows.slice(0, SAMPLE)) {
      console.log(`  - ${csv.nct_id} ↔ ${csv.project_number}  [${reasons.join('; ')}]`)
    }
  }

  if (orphanRows.length > 0) {
    console.log(`\nSample orphans (first ${Math.min(SAMPLE, orphanRows.length)}):`)
    for (const r of orphanRows.slice(0, SAMPLE)) {
      const title = (r.study_title || '').slice(0, 72)
      console.log(`  - ${r.nct_id} ↔ ${r.project_number}  [${r.study_status || '–'}]  ${title}`)
    }
    console.log(
      `\n  Note: orphans are NOT deleted. They usually reflect Core Project Number\n  formatting drift on the NIH side, not retracted trials.`
    )
  }

  console.log('\nNo DB writes were made. This script is read-only.')
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
