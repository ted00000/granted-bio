import { supabaseAdmin } from '../src/lib/supabase'

const REPORT_ID = 'e6aadd32-9e87-4877-814b-1a2ffc664329'

async function main() {
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('*')
    .eq('id', REPORT_ID)
    .single()

  if (error || !data) {
    console.error('fetch failed:', error)
    process.exit(1)
  }

  console.log('=== BASICS ===')
  console.log('TOPIC:', data.topic)
  console.log('PERSONA:', data.persona)
  console.log('CREATED:', data.created_at)
  console.log('STATUS:', data.status)
  console.log('DATA_LIMITED:', data.data_limited)
  console.log('PROJECTS:', data.project_count)
  console.log('TRIALS:', (data.clinical_trials as any[])?.length ?? 0)
  console.log('PUBS:', (data.publications as any[])?.length ?? 0)
  console.log('CURATED PUBS:', (data.curated_publications as any[])?.length ?? 0)
  console.log('PATENTS:', (data.patents as any[])?.length ?? 0)
  console.log('FUNDING TOTAL:', (data.funding_stats as any)?.total)

  const sa = data.signals_analysis as any
  console.log('\n=== SIGNALS_ANALYSIS keys ===')
  if (sa) console.log(Object.keys(sa).join(', '))

  const ao = data.agent_outputs as any
  console.log('\n=== AGENT_OUTPUTS keys ===')
  if (ao) console.log(Object.keys(ao).join(', '))

  console.log('\n=== WHITE SPACE (from signals_analysis) ===')
  const ws = sa?.whiteSpace || sa?.white_space || ao?.whiteSpace || ao?.white_space
  if (ws) {
    console.log('has dimensions:', !!ws.dimensions, 'count:', ws.dimensions?.length)
    if (ws.dimensions) {
      for (const d of ws.dimensions) {
        const total = d.categories?.reduce((s: number, c: any) => s + (c.projectCount ?? c.matches ?? 0), 0) ?? 0
        console.log(`\n  ${d.name}: ${total}/${data.project_count} classified`)
        console.log(`    keywords: ${(d.keywords || []).slice(0,5).join(', ')}`)
        if (d.categories) {
          for (const c of d.categories) {
            console.log(`    - ${c.name}: ${c.projectCount ?? c.matches ?? 0}`)
          }
        }
      }
    }
    if (ws.scopeWarning) {
      console.log('\n  SCOPE WARNING:', ws.scopeWarning)
    }
  } else {
    console.log('(none found)')
  }

  console.log('\n=== EXECUTIVE SUMMARY ===')
  const exec = data.executive_summary as any
  if (typeof exec === 'string') {
    console.log(exec.slice(0, 2500))
  } else if (exec) {
    console.log(JSON.stringify(exec, null, 2).slice(0, 2500))
  }

  console.log('\n=== MARKDOWN (first 2500 chars) ===')
  if (data.markdown_content) {
    console.log(String(data.markdown_content).slice(0, 2500))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
