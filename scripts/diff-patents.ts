// Diff an ExPORTER Patents.csv against the live `patents` + `project_patents`
// DB tables. Read-only — touches no entity tables, calls no paid APIs.
//
// Usage:
//   npx tsx scripts/diff-patents.ts <path-to-Patents.csv>
//
// Outputs two parallel diffs:
//
//   patents table (metadata)
//     - new      : patent_id in CSV, not in DB
//     - changed  : patent_id in both, patent_title or patent_org differs
//     - orphan   : patent_id in DB, not in CSV
//
//   project_patents table (links)
//     - new      : (project_number, patent_id) in CSV, not in DB
//     - orphan   : (project_number, patent_id) in DB, not in CSV
//
// The two diffs can have very different sizes — e.g. a single new patent
// adds 1 patents-row + 1+ project_patents-rows, while a status update to
// an existing patent_id only touches the patents table.
//
// Run before any patents ingest. If new + changed is small relative to
// the total CSV, use the targeted delta loader (etl/load_patents_delta.py)
// instead of a full upsert. See docs/DATA_SOURCE_PLAYBOOKS.md (Source 5).

import { config } from 'dotenv'
config({ path: '.env.local' })

import * as fs from 'fs'
import Papa from 'papaparse'

interface CsvPatentRow {
  patent_id: string
  patent_title: string
  patent_org: string
}

interface DbPatentRow {
  patent_id: string
  patent_title: string | null
  patent_org: string | null
}

function linkKey(proj: string, pat: string): string {
  return `${proj}|${pat}`
}

function readCsv(path: string): {
  patentsById: Map<string, CsvPatentRow>
  linkSet: Set<string>
  linkCount: number
} {
  console.log(`Reading CSV: ${path}`)
  if (!fs.existsSync(path)) {
    console.error(`File not found: ${path}`)
    process.exit(1)
  }
  const content = fs.readFileSync(path, 'utf-8')

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

  const patentsById = new Map<string, CsvPatentRow>()
  const linkSet = new Set<string>()
  let skippedNoPatentId = 0
  let skippedNoProject = 0
  let linkCount = 0

  for (const row of parsed.data) {
    const patent_id = (row['PATENT_ID'] || '').trim()
    if (!patent_id) {
      skippedNoPatentId++
      continue
    }
    // For patents metadata: first occurrence wins (matches process_patents.py
    // which uses an in-memory dict).
    if (!patentsById.has(patent_id)) {
      patentsById.set(patent_id, {
        patent_id,
        patent_title: (row['PATENT_TITLE'] || '').trim(),
        patent_org: (row['PATENT_ORG_NAME'] || '').trim(),
      })
    }
    const project_number = (row['PROJECT_ID'] || '').trim()
    if (!project_number) {
      skippedNoProject++
      continue
    }
    linkSet.add(linkKey(project_number, patent_id))
    linkCount++
  }

  console.log(
    `  CSV: ${parsed.data.length.toLocaleString()} rows parsed → ` +
      `${patentsById.size.toLocaleString()} unique patents, ` +
      `${linkSet.size.toLocaleString()} unique links ` +
      `(${skippedNoPatentId} skipped: no patent_id; ${skippedNoProject} skipped: no project)`
  )
  return { patentsById, linkSet, linkCount }
}

async function readDbPatents(): Promise<Map<string, DbPatentRow>> {
  console.log('Reading patents from DB...')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const map = new Map<string, DbPatentRow>()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('patents')
      .select('patent_id, patent_title, patent_org')
      .range(offset, offset + pageSize - 1)
    if (error) {
      console.error(`patents DB query failed at offset ${offset}:`, error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!row.patent_id) continue
      map.set(row.patent_id, {
        patent_id: row.patent_id,
        patent_title: row.patent_title,
        patent_org: row.patent_org,
      })
    }
    if (data.length < pageSize) break
    offset += pageSize
  }

  console.log(`  DB patents: ${map.size.toLocaleString()} unique patent_id`)
  return map
}

async function readDbLinks(): Promise<Set<string>> {
  console.log('Reading project_patents from DB...')
  const { supabaseAdmin } = await import('../src/lib/supabase')

  const set = new Set<string>()
  const pageSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('project_patents')
      .select('project_number, patent_id')
      .range(offset, offset + pageSize - 1)
    if (error) {
      console.error(`project_patents DB query failed at offset ${offset}:`, error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!row.project_number || !row.patent_id) continue
      set.add(linkKey(row.project_number, row.patent_id))
    }
    if (data.length < pageSize) break
    offset += pageSize
  }

  console.log(`  DB project_patents: ${set.size.toLocaleString()} unique links`)
  return set
}

function normalize(s: string | null | undefined): string {
  return (s || '').trim()
}

async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/diff-patents.ts <path-to-Patents.csv>')
    process.exit(1)
  }

  console.log('='.repeat(64))
  console.log('Patents Diff — CSV vs DB (read-only)')
  console.log('='.repeat(64))

  const csv = readCsv(csvPath)
  const [dbPatents, dbLinks] = await Promise.all([readDbPatents(), readDbLinks()])

  // patents table diff
  const newPatents: CsvPatentRow[] = []
  const changedPatents: { csv: CsvPatentRow; db: DbPatentRow; reasons: string[] }[] = []
  const orphanPatents: DbPatentRow[] = []

  for (const [patent_id, csvRow] of csv.patentsById) {
    const dbRow = dbPatents.get(patent_id)
    if (!dbRow) {
      newPatents.push(csvRow)
      continue
    }
    const reasons: string[] = []
    if (normalize(dbRow.patent_title) !== normalize(csvRow.patent_title)) {
      reasons.push('title changed')
    }
    if (normalize(dbRow.patent_org) !== normalize(csvRow.patent_org)) {
      reasons.push('assignee changed')
    }
    if (reasons.length > 0) {
      changedPatents.push({ csv: csvRow, db: dbRow, reasons })
    }
  }
  for (const [patent_id, dbRow] of dbPatents) {
    if (!csv.patentsById.has(patent_id)) orphanPatents.push(dbRow)
  }

  // project_patents table diff
  const newLinks: string[] = []
  const orphanLinks: string[] = []
  for (const k of csv.linkSet) if (!dbLinks.has(k)) newLinks.push(k)
  for (const k of dbLinks) if (!csv.linkSet.has(k)) orphanLinks.push(k)

  const matchedPatents = csv.patentsById.size - newPatents.length - changedPatents.length
  const matchedLinks = csv.linkSet.size - newLinks.length

  console.log()
  console.log('='.repeat(64))
  console.log('Results: patents table')
  console.log('='.repeat(64))
  console.log(`New      (in CSV, not in DB)         : ${newPatents.length.toLocaleString()}`)
  console.log(`Changed  (patent_id matches, fields differ): ${changedPatents.length.toLocaleString()}`)
  console.log(`Orphan   (in DB, not in CSV)         : ${orphanPatents.length.toLocaleString()}`)
  console.log(`Matched unchanged                    : ${matchedPatents.toLocaleString()}`)

  console.log()
  console.log('='.repeat(64))
  console.log('Results: project_patents table (link rows)')
  console.log('='.repeat(64))
  console.log(`New      (in CSV, not in DB)         : ${newLinks.length.toLocaleString()}`)
  console.log(`Orphan   (in DB, not in CSV)         : ${orphanLinks.length.toLocaleString()}`)
  console.log(`Matched                              : ${matchedLinks.toLocaleString()}`)

  const SAMPLE = 5

  if (newPatents.length > 0) {
    console.log(`\nSample new patents (first ${Math.min(SAMPLE, newPatents.length)}):`)
    for (const r of newPatents.slice(0, SAMPLE)) {
      console.log(
        `  - ${r.patent_id}  [${(r.patent_org || '–').slice(0, 32)}]  ${(r.patent_title || '').slice(0, 60)}`
      )
    }
  }

  if (changedPatents.length > 0) {
    console.log(`\nSample changed patents (first ${Math.min(SAMPLE, changedPatents.length)}):`)
    for (const { csv: c, reasons } of changedPatents.slice(0, SAMPLE)) {
      console.log(`  - ${c.patent_id}  [${reasons.join('; ')}]`)
    }
  }

  if (orphanPatents.length > 0) {
    console.log(`\nSample orphan patents (first ${Math.min(SAMPLE, orphanPatents.length)}):`)
    for (const r of orphanPatents.slice(0, SAMPLE)) {
      console.log(`  - ${r.patent_id}  [${(r.patent_org || '–').slice(0, 32)}]`)
    }
  }

  if (newLinks.length > 0) {
    console.log(`\nSample new links (first ${Math.min(SAMPLE, newLinks.length)}):`)
    for (const k of newLinks.slice(0, SAMPLE)) {
      const [proj, pat] = k.split('|')
      console.log(`  - project ${proj} ↔ patent ${pat}`)
    }
  }

  if (orphanLinks.length > 0) {
    console.log(`\nSample orphan links (first ${Math.min(SAMPLE, orphanLinks.length)}):`)
    for (const k of orphanLinks.slice(0, SAMPLE)) {
      const [proj, pat] = k.split('|')
      console.log(`  - project ${proj} ↔ patent ${pat}`)
    }
    console.log(
      `\n  Note: orphan links are NOT deleted. They usually reflect Core\n  Project Number formatting drift, not retracted patents.`
    )
  }

  console.log('\nNo DB writes were made. This script is read-only.')
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
