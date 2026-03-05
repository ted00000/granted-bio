import { config } from 'dotenv'
config({ path: '.env.local' })

async function check() {
  const { supabaseAdmin } = await import('../src/lib/supabase')

  console.log('=== Checking project linkages ===\n')

  // Publications linking
  const { count: pubLinkCount } = await supabaseAdmin
    .from('project_publications')
    .select('*', { count: 'exact', head: true })
  console.log(`project_publications: ${pubLinkCount?.toLocaleString()} rows`)

  // Patents - check if linked via project_number column
  const { count: patentCount } = await supabaseAdmin
    .from('patents')
    .select('*', { count: 'exact', head: true })
    .not('project_number', 'is', null)
  console.log(`patents with project_number: ${patentCount?.toLocaleString()} rows`)

  // Trials - check for linking table or project_number column
  const { data: trialCols } = await supabaseAdmin
    .from('clinical_studies')
    .select('*')
    .limit(1)

  const trialColumns = trialCols?.[0] ? Object.keys(trialCols[0]) : []
  console.log(`\nclinical_studies columns: ${trialColumns.join(', ')}`)

  // Check if project_number exists in clinical_studies
  if (trialColumns.includes('project_number')) {
    const { count: trialLinkCount } = await supabaseAdmin
      .from('clinical_studies')
      .select('*', { count: 'exact', head: true })
      .not('project_number', 'is', null)
    console.log(`clinical_studies with project_number: ${trialLinkCount?.toLocaleString()} rows`)
  }

  // Check for project_clinical_studies linking table
  try {
    const { count: linkCount } = await supabaseAdmin
      .from('project_clinical_studies')
      .select('*', { count: 'exact', head: true })
    console.log(`project_clinical_studies: ${linkCount?.toLocaleString()} rows`)
  } catch {
    console.log('project_clinical_studies: table not found')
  }

  // Sample a project with links
  console.log('\n=== Sample CAR-T project links ===')

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('project_number, title, patent_count, publication_count, clinical_trial_count')
    .ilike('title', '%CAR-T%')
    .gt('publication_count', 0)
    .limit(3)

  for (const p of projects || []) {
    console.log(`\n${p.title?.substring(0, 50)}...`)
    console.log(`  project_number: ${p.project_number}`)
    console.log(`  patent_count: ${p.patent_count}, pub_count: ${p.publication_count}, trial_count: ${p.clinical_trial_count}`)
  }
}

check().catch(console.error)
