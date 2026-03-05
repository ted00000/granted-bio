import { config } from 'dotenv'
config({ path: '.env.local' })

async function check() {
  const { supabaseAdmin } = await import('../src/lib/supabase')

  // Get a CAR-T project
  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('application_id, project_number, title')
    .ilike('title', '%CAR-T%')
    .limit(1)
    .single()

  if (!project) {
    console.log('No CAR-T project found')
    return
  }

  console.log('Sample CAR-T project:', project.title)
  console.log('Project number:', project.project_number)

  // Check linked publications
  const { data: pubs, count: pubCount } = await supabaseAdmin
    .from('project_publications')
    .select('pmid', { count: 'exact' })
    .eq('project_number', project.project_number)

  console.log(`\nLinked publications: ${pubCount}`)
  if (pubs && pubs.length > 0) {
    // Get pub details
    const { data: pubDetails } = await supabaseAdmin
      .from('publications')
      .select('pub_title')
      .in('pmid', pubs.slice(0, 5).map(p => p.pmid))

    console.log('Sample pub titles:', pubDetails?.map(p => p.pub_title?.substring(0, 60)))
  }

  // Check linked patents - what table?
  const { data: patents, count: patentCount } = await supabaseAdmin
    .from('patents')
    .select('patent_title', { count: 'exact' })
    .eq('project_number', project.project_number)

  console.log(`\nLinked patents: ${patentCount}`)
  console.log('Sample patent titles:', patents?.slice(0, 3).map(p => p.patent_title?.substring(0, 60)))

  // Check linked trials - via project_trials?
  const tables = ['project_trials', 'project_clinical_studies', 'clinical_study_projects']
  for (const table of tables) {
    try {
      const { count } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .limit(1)
      console.log(`\n${table}: exists with ${count} rows`)
    } catch {
      console.log(`\n${table}: does not exist`)
    }
  }
}

check().catch(console.error)
