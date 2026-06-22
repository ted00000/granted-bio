import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')

  // 1. Row counts
  const { count: pubCount } = await supabaseAdmin
    .from('publications').select('*', { count: 'exact', head: true })
  const { count: linkCount } = await supabaseAdmin
    .from('project_publications').select('*', { count: 'exact', head: true })
  const { count: projCount } = await supabaseAdmin
    .from('projects').select('*', { count: 'exact', head: true })

  console.log('Row counts:')
  console.log(`  projects             : ${(projCount ?? 0).toLocaleString()}`)
  console.log(`  publications         : ${(pubCount ?? 0).toLocaleString()}`)
  console.log(`  project_publications : ${(linkCount ?? 0).toLocaleString()}`)
  console.log(`  links per pub avg    : ${pubCount ? ((linkCount ?? 0) / pubCount).toFixed(2) : 'n/a'}`)
  console.log(`  links per proj avg   : ${projCount ? ((linkCount ?? 0) / projCount).toFixed(2) : 'n/a'}`)

  // 2. Sample publication (show full schema)
  const { data: samplePub } = await supabaseAdmin
    .from('publications').select('*').not('pub_title', 'is', null).limit(1).single()
  if (samplePub) {
    console.log('\n--- Sample publication row ---')
    for (const [k, v] of Object.entries(samplePub)) {
      if (k.endsWith('_embedding')) {
        console.log(`  ${k}: <vector, length=${Array.isArray(v) ? v.length : 'n/a'}>`)
      } else {
        const display = typeof v === 'string' && v.length > 120 ? v.slice(0, 117) + '...' : v
        console.log(`  ${k}:`, display)
      }
    }
  }

  // 3. Pick a publication that's linked to several projects (many-to-many direction A)
  console.log('\n--- One publication, multiple linked projects ---')
  const { data: linkSamples } = await supabaseAdmin
    .from('project_publications').select('pmid, project_number').limit(2000)
  if (linkSamples && linkSamples.length > 0) {
    const byPmid = new Map<string, string[]>()
    for (const l of linkSamples) {
      if (!byPmid.has(l.pmid)) byPmid.set(l.pmid, [])
      byPmid.get(l.pmid)!.push(l.project_number)
    }
    const multi = [...byPmid.entries()].filter(([, projs]) => projs.length >= 3).sort((a, b) => b[1].length - a[1].length)[0]
    if (multi) {
      const [pmid, projNums] = multi
      const { data: pub } = await supabaseAdmin
        .from('publications').select('pmid, pub_title, pub_year, journal_title').eq('pmid', pmid).single()
      console.log(`  PMID ${pmid}: "${pub?.pub_title?.slice(0, 100)}..."`)
      console.log(`  Journal: ${pub?.journal_title}, year ${pub?.pub_year}`)
      console.log(`  Linked to ${projNums.length} project_numbers (showing first 5):`)
      const { data: linkedProjs } = await supabaseAdmin
        .from('projects').select('project_number, title, org_name, fiscal_year').in('project_number', projNums.slice(0, 5))
      for (const p of (linkedProjs ?? [])) {
        console.log(`    ${p.project_number} | FY${p.fiscal_year} | ${p.org_name}`)
        console.log(`      "${p.title?.slice(0, 90)}..."`)
      }
    }
  }

  // 4. Direction B: one project with many linked publications
  console.log('\n--- One project, multiple linked publications ---')
  if (linkSamples) {
    const byProj = new Map<string, string[]>()
    for (const l of linkSamples) {
      if (!byProj.has(l.project_number)) byProj.set(l.project_number, [])
      byProj.get(l.project_number)!.push(l.pmid)
    }
    const multi = [...byProj.entries()].filter(([, pmids]) => pmids.length >= 3).sort((a, b) => b[1].length - a[1].length)[0]
    if (multi) {
      const [projNum, pmids] = multi
      const { data: proj } = await supabaseAdmin
        .from('projects').select('project_number, title, org_name, fiscal_year, primary_category').eq('project_number', projNum).limit(1).maybeSingle()
      console.log(`  Project ${projNum}: "${proj?.title?.slice(0, 100)}..."`)
      console.log(`  Org: ${proj?.org_name}, FY${proj?.fiscal_year}, category=${proj?.primary_category}`)
      console.log(`  Has ${pmids.length} linked publications (showing first 5):`)
      const { data: linkedPubs } = await supabaseAdmin
        .from('publications').select('pmid, pub_title, pub_year, journal_title').in('pmid', pmids.slice(0, 5))
      for (const p of (linkedPubs ?? [])) {
        console.log(`    PMID ${p.pmid} | ${p.journal_title} | ${p.pub_year}`)
        console.log(`      "${p.pub_title?.slice(0, 90)}..."`)
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
