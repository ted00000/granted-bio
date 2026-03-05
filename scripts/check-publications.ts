import { config } from 'dotenv'
config({ path: '.env.local' })

async function check() {
  const { supabaseAdmin } = await import('../src/lib/supabase')

  // Check for CAR-T specific publications
  const { data: cartPubs, count } = await supabaseAdmin
    .from('publications')
    .select('pmid, pub_title', { count: 'exact' })
    .ilike('pub_title', '%CAR-T%')
    .limit(10)

  console.log(`Publications with "CAR-T" in title: ${count}`)
  console.log('Samples:', cartPubs?.map(p => p.pub_title).slice(0, 5))

  // Check for "chimeric antigen receptor"
  const { count: carCount } = await supabaseAdmin
    .from('publications')
    .select('*', { count: 'exact', head: true })
    .ilike('pub_title', '%chimeric antigen receptor%')

  console.log(`\nPublications with "chimeric antigen receptor" in title: ${carCount}`)

  // Check for clinical trials with CAR-T
  const { data: cartTrials, count: trialCount } = await supabaseAdmin
    .from('clinical_studies')
    .select('nct_id, study_title', { count: 'exact' })
    .ilike('study_title', '%CAR-T%')
    .limit(10)

  console.log(`\nTrials with "CAR-T" in title: ${trialCount}`)
  console.log('Samples:', cartTrials?.map(t => t.study_title).slice(0, 5))

  // Check for "chimeric antigen receptor" trials
  const { count: carTrialCount } = await supabaseAdmin
    .from('clinical_studies')
    .select('*', { count: 'exact', head: true })
    .ilike('study_title', '%chimeric antigen receptor%')

  console.log(`\nTrials with "chimeric antigen receptor" in title: ${carTrialCount}`)
}

check().catch(console.error)
