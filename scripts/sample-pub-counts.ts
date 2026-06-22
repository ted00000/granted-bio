import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Strip a full NIH project_number ("5U01DA041022-12", "1R01HG011711-05A1")
// down to the core ("U01DA041022", "R01HG011711") that the API expects.
function toCore(full: string): string {
  // Strip leading single funding-type digit (1=new, 2=renewal, 3=supplement, 5=continuation, 7=transfer, 9=split)
  let s = full.replace(/^[1-9]/, '')
  // Strip trailing year/amendment suffix (-NN, -NNAY, -NNSY etc.)
  s = s.replace(/-.+$/, '')
  return s
}

async function pubCount(projectNumber: string): Promise<number> {
  const core = toCore(projectNumber)
  const resp = await fetch('https://api.reporter.nih.gov/v2/publications/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ criteria: { core_project_nums: [core] }, limit: 1, offset: 0 })
  })
  const j = await resp.json()
  return j?.meta?.total ?? 0
}

async function main() {
  // Get a roughly representative sample across activity codes
  const { data } = await supabase
    .from('projects')
    .select('project_number, activity_code, fiscal_year, title')
    .not('project_number', 'is', null)
    .limit(5000)

  if (!data) return
  const N = Number(process.env.N ?? 50)
  const sample = data.sort(() => Math.random() - 0.5).slice(0, N)
  console.log(`Sampling ${sample.length} projects to see API pub count distribution:`)
  console.log()

  const rows: { count: number, activity: string, fy: number, full: string, core: string, title: string }[] = []
  for (const p of sample) {
    const c = await pubCount(p.project_number)
    rows.push({ count: c, activity: p.activity_code, fy: p.fiscal_year, full: p.project_number, core: toCore(p.project_number), title: p.title || '' })
    await new Promise(r => setTimeout(r, 1100))
  }

  const counts = rows.map(r => r.count).sort((a, b) => a - b)
  const sum = counts.reduce((a, b) => a + b, 0)
  const pct = (q: number) => counts[Math.min(counts.length - 1, Math.floor(q * counts.length))]
  const trimmed = counts.slice(Math.floor(counts.length * 0.1), Math.ceil(counts.length * 0.9))
  const trimSum = trimmed.reduce((a, b) => a + b, 0)

  console.log('Full distribution:')
  console.log(`  n=${counts.length}, min=${counts[0]}, max=${counts[counts.length - 1]}, mean=${(sum / counts.length).toFixed(1)}`)
  console.log(`  p10=${pct(0.10)}, p25=${pct(0.25)}, p50=${pct(0.50)}, p75=${pct(0.75)}, p90=${pct(0.90)}, p95=${pct(0.95)}`)
  console.log(`  Trimmed mean (10-90%): ${(trimSum / trimmed.length).toFixed(1)} — drops center-grant outliers`)
  console.log()
  console.log('Top 5 by pub count:')
  rows.sort((a, b) => b.count - a.count).slice(0, 5).forEach(r => {
    console.log(`  ${r.core} [${r.activity}]: ${r.count} pubs — ${r.title.slice(0, 60)}`)
  })
  console.log()
  console.log('Bottom 5 by pub count:')
  rows.sort((a, b) => a.count - b.count).slice(0, 5).forEach(r => {
    console.log(`  ${r.core} [${r.activity} FY${r.fy}]: ${r.count} pubs — ${r.title.slice(0, 60)}`)
  })

  // Center-grant pattern check
  const centerActivities = new Set(['P30', 'P50', 'P20', 'P40', 'P41', 'P42', 'P51', 'P60', 'P2C', 'U01', 'U54', 'U24', 'U2C'])
  const centerRows = rows.filter(r => centerActivities.has(r.activity))
  const nonCenterRows = rows.filter(r => !centerActivities.has(r.activity))
  const centerSum = centerRows.reduce((a, b) => a + b.count, 0)
  const nonCenterSum = nonCenterRows.reduce((a, b) => a + b.count, 0)
  console.log()
  console.log(`Center vs non-center breakdown:`)
  console.log(`  ${centerRows.length} center/consortium projects: ${centerSum} pubs total, mean=${centerRows.length ? (centerSum / centerRows.length).toFixed(1) : 'n/a'}`)
  console.log(`  ${nonCenterRows.length} non-center projects: ${nonCenterSum} pubs total, mean=${nonCenterRows.length ? (nonCenterSum / nonCenterRows.length).toFixed(1) : 'n/a'}`)
  console.log(`  Center share of total pubs: ${sum ? ((centerSum / sum) * 100).toFixed(1) : '0'}%`)
}

main().catch(e => { console.error(e); process.exit(1) })
