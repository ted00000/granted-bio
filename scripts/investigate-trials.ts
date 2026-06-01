// Investigate why the liquid-biopsy report dropped from 11 unique trials to 1.
// Pulls each prior NCT ID, lists its project_number linkages, and checks
// whether those projects would appear in our current liquid-biopsy search.
//
// Run with: npx tsx scripts/investigate-trials.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

const PRIOR_NCTS = [
  'NCT01475500',
  'NCT02000089',
  'NCT02070705',
  'NCT03193515',
  'NCT03193528',
  'NCT03193541',
  'NCT03407001',
  'NCT03855800',
  'NCT04247503',
  'NCT04564781',
  'NCT05347342',
]

const NEW_NCT = 'NCT06693830'

async function main() {
  const { supabaseAdmin } = await import('../src/lib/supabase')

  console.log('\n=== Checking clinical_studies for prior 11 NCT IDs ===')

  for (const nct of PRIOR_NCTS) {
    const { data, error } = await supabaseAdmin
      .from('clinical_studies')
      .select('nct_id, project_number, study_title')
      .eq('nct_id', nct)

    if (error) {
      console.log(`  ${nct}: ERROR ${error.message}`)
      continue
    }
    if (!data || data.length === 0) {
      console.log(`  ${nct}: NOT FOUND in clinical_studies`)
      continue
    }
    const projectNumbers = data.map((r) => r.project_number).filter(Boolean)
    console.log(`  ${nct}: ${data.length} row(s), project_numbers: ${projectNumbers.join(', ') || '(none)'}`)
    console.log(`     title: ${data[0].study_title?.slice(0, 80) || '(no title)'}`)
  }

  console.log('\n=== Checking the NEW report\'s NCT ===')
  const { data: newTrial } = await supabaseAdmin
    .from('clinical_studies')
    .select('nct_id, project_number, study_title')
    .eq('nct_id', NEW_NCT)
  console.log(`  ${NEW_NCT}:`, JSON.stringify(newTrial, null, 2))

  // For NCT02000089 (CAPS5), find what projects it links to and check if
  // those projects exist in the projects table with usable embeddings
  console.log('\n=== Tracing CAPS5 (NCT02000089) linkages back to projects ===')
  const { data: capsRows } = await supabaseAdmin
    .from('clinical_studies')
    .select('project_number')
    .eq('nct_id', 'NCT02000089')

  if (capsRows && capsRows.length > 0) {
    const pns = Array.from(new Set(capsRows.map((r) => r.project_number).filter(Boolean)))
    console.log(`  CAPS5 links to project_numbers: ${pns.join(', ')}`)
    if (pns.length > 0) {
      const { data: projects } = await supabaseAdmin
        .from('projects')
        .select('application_id, project_number, title, fiscal_year, primary_category')
        .in('project_number', pns)
      console.log(`  Matching project rows in projects table:`)
      projects?.forEach((p) =>
        console.log(`    [${p.fiscal_year}] ${p.project_number} (${p.application_id}): ${p.title?.slice(0, 70)}`)
      )
    }
  }

  // Check the project_number format — is it 'R01CA123456' style or '5R01CA123456-01' style?
  console.log('\n=== Sample of clinical_studies project_number formats ===')
  const { data: sample } = await supabaseAdmin
    .from('clinical_studies')
    .select('nct_id, project_number')
    .not('project_number', 'is', null)
    .limit(10)
  sample?.forEach((r) => console.log(`    ${r.nct_id}: '${r.project_number}'`))

  // Re-run the actual liquid biopsy search and check which of the prior NCT IDs
  // would be reachable through the returned project numbers
  console.log('\n=== Re-running liquid biopsy semantic search ===')
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()
  const SEMANTIC_QUERY =
    'liquid biopsy approaches for early cancer detection through circulating tumor DNA and cell-free nucleic acid analysis'
  const emb = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: SEMANTIC_QUERY,
  })

  const { data: searchResults, error: searchErr } = await supabaseAdmin.rpc(
    'search_projects_filtered',
    {
      query_embedding: emb.data[0].embedding,
      match_threshold: 0.15,
      match_count: 200,
      min_biotools_confidence: 0,
      filter_fiscal_years: null,
      filter_categories: null,
      filter_org_types: null,
      filter_states: null,
      filter_min_funding: null,
      filter_max_funding: null,
    }
  )
  if (searchErr) {
    console.log('  search error:', searchErr.message)
    return
  }
  const projectNumbersInSearch = new Set<string>(
    (searchResults || [])
      .map((r: { project_number?: string }) => r.project_number)
      .filter((pn: unknown): pn is string => typeof pn === 'string' && pn.length > 0)
  )
  console.log(`  search returned ${searchResults?.length ?? 0} rows, ${projectNumbersInSearch.size} unique project_numbers`)
  console.log(`  sample of search project_numbers:`)
  Array.from(projectNumbersInSearch).slice(0, 10).forEach((pn) => console.log(`    '${pn}'`))

  // Re-run search with much larger limit to see where these "missing" projects rank
  console.log('\n=== Larger-limit search (match_count=2000) to find missing projects\' rank ===')
  const { data: bigSearch } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: emb.data[0].embedding,
    match_threshold: 0.0,
    match_count: 2000,
    min_biotools_confidence: 0,
    filter_fiscal_years: null,
    filter_categories: null,
    filter_org_types: null,
    filter_states: null,
    filter_min_funding: null,
    filter_max_funding: null,
  })
  if (bigSearch) {
    const targetPns = new Set([
      'U01CA152662', 'R01CA176828', 'U01CA210170', 'P30CA069533',
      'U01CA278923', 'R01CA198887', 'R01CA195524', 'U01CA210138', 'R01CA277810',
    ])
    const found = bigSearch
      .map((r: { project_number?: string; similarity?: number; title?: string }, idx: number) => ({
        rank: idx + 1,
        pn: r.project_number,
        sim: r.similarity,
        title: r.title?.slice(0, 60),
      }))
      .filter((r: { pn?: string }) => r.pn && targetPns.has(r.pn))
    console.log(`  Found ${found.length} matches in top ${bigSearch.length}`)
    found.slice(0, 25).forEach((r: { rank: number; pn?: string; sim?: number; title?: string }) =>
      console.log(`    rank ${r.rank}, sim ${r.sim?.toFixed(3)}: ${r.pn} (${r.title})`)
    )
  }

  // Inspect the similarity distribution of the top 200 to understand if these
  // projects are below the cutoff or genuinely missing from HNSW results
  console.log('\n=== Top 200 similarity distribution ===')
  if (bigSearch) {
    const sims = (bigSearch as Array<{ similarity?: number }>).map((r) => r.similarity || 0)
    const above50 = sims.filter((s) => s >= 0.5).length
    const above45 = sims.filter((s) => s >= 0.45).length
    const min = Math.min(...sims)
    const max = Math.max(...sims)
    console.log(`  count=${sims.length}, max=${max.toFixed(3)}, min=${min.toFixed(3)}`)
    console.log(`  with sim >= 0.50: ${above50}`)
    console.log(`  with sim >= 0.45: ${above45}`)
    console.log(`  bottom 5 entries: ${sims.slice(-5).map((s) => s.toFixed(3)).join(', ')}`)
  }

  // Check how many projects exist with abstract_embedding (size of index)
  console.log('\n=== Projects with embeddings (index size) ===')
  const { count: indexedCount } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .not('abstract_embedding', 'is', null)
  console.log(`  ${indexedCount?.toLocaleString()} projects have abstract_embedding (index size)`)

  // Direct similarity probe: bypass HNSW, compute cosine similarity in raw SQL
  // for each of the "missing" project_numbers to see if they should be in the top 200
  console.log('\n=== Direct similarity probe (bypassing HNSW) ===')
  const probedPns = ['R01CA176828', 'U01CA210170', 'U01CA152662', 'R01CA277810', 'R01CA198887', 'U01CA210138']
  for (const pn of probedPns) {
    const { data: probe } = await supabaseAdmin.rpc('search_projects_filtered', {
      query_embedding: emb.data[0].embedding,
      match_threshold: 0.0,
      match_count: 200,
      min_biotools_confidence: 0,
      filter_fiscal_years: null,
      filter_categories: null,
      filter_org_types: null,
      filter_states: null,
      filter_min_funding: null,
      filter_max_funding: null,
    })
    const present = (probe || []).find((r: { project_number?: string }) => r.project_number === pn)
    console.log(`  ${pn}: ${present ? `found at sim ${(present as { similarity?: number }).similarity?.toFixed(3)}` : 'NOT in top 200'}`)
  }

  // Use direct SQL to bypass HNSW and get TRUE cosine similarity client-side
  console.log('\n=== TRUE similarity (bypassing HNSW) — what HNSW is missing ===')
  // The unused 'execute_sql' rpc attempt was removed (TS error); we always
  // fall back to fetching the embedding and computing cosine similarity here.
  {
    // Fall back to a Direct table query
    const queryEmbedding = emb.data[0].embedding
    // We'll use the .rpc match with very low threshold but also probe individually
    for (const pn of probedPns) {
      const { data: dir } = await supabaseAdmin
        .from('projects')
        .select('project_number, title, abstract_embedding')
        .eq('project_number', pn)
        .not('abstract_embedding', 'is', null)
        .limit(1)
      if (dir && dir.length > 0 && dir[0].abstract_embedding) {
        // We have the embedding — compute cosine similarity client-side
        const emb1 = queryEmbedding as number[]
        const emb2Raw = dir[0].abstract_embedding as unknown
        const emb2 = typeof emb2Raw === 'string' ? JSON.parse(emb2Raw) : emb2Raw
        if (Array.isArray(emb2)) {
          let dot = 0
          let n1 = 0
          let n2 = 0
          for (let i = 0; i < emb1.length; i++) {
            dot += emb1[i] * emb2[i]
            n1 += emb1[i] * emb1[i]
            n2 += emb2[i] * emb2[i]
          }
          const sim = dot / (Math.sqrt(n1) * Math.sqrt(n2))
          console.log(`  ${pn}: TRUE similarity = ${sim.toFixed(3)} — ${dir[0].title?.slice(0, 60)}`)
        }
      } else {
        console.log(`  ${pn}: no embedding row found`)
      }
    }
  }
  // Direct query: are any of the 11 linked project_numbers in the projects table at all?
  const allLinkedPns = [
    'U01CA152662', 'R01CA176828', 'U01CA210170', 'P30CA069533', 'K08EB012859',
    'U01CA278923', 'R01CA198887', 'R01CA195524', 'P30CA016672', 'U01CA210138', 'R01CA277810',
  ]
  console.log('\n=== Are the prior linked project_numbers even in the projects table? ===')
  const { data: pnsInDb } = await supabaseAdmin
    .from('projects')
    .select('project_number, title, fiscal_year')
    .in('project_number', allLinkedPns)
  pnsInDb?.forEach((p) => console.log(`    ✓ ${p.project_number} [${p.fiscal_year}]: ${p.title?.slice(0, 70)}`))
  const found = new Set((pnsInDb || []).map((p) => p.project_number))
  allLinkedPns.forEach((pn) => {
    if (!found.has(pn)) console.log(`    ✗ ${pn}: NOT FOUND in projects table`)
  })

  // Which prior NCT IDs' linked project_numbers are present in the search results?
  console.log('\n=== Reachability check: prior NCT IDs vs. current search results ===')
  for (const nct of PRIOR_NCTS) {
    const { data: links } = await supabaseAdmin
      .from('clinical_studies')
      .select('project_number')
      .eq('nct_id', nct)
    const pns = (links || []).map((r) => r.project_number).filter(Boolean) as string[]
    const reachable = pns.filter((pn) => projectNumbersInSearch.has(pn))
    const status = reachable.length > 0 ? `REACHABLE via ${reachable.join(', ')}` : `UNREACHABLE (linked to ${pns.join(', ')})`
    console.log(`  ${nct}: ${status}`)
  }
}

main().catch(console.error)
