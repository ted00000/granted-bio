/**
 * Find projects where org_type='company' but org_name suggests
 * university/hospital/research institute. Dump the fields that
 * determine_org_type sees (org_name, funding_mechanism, activity_code)
 * so we can pinpoint which check is misfiring.
 */

import { supabaseAdmin } from '../src/lib/supabase'

interface Row {
  id: number
  project_number: string | null
  org_name: string | null
  org_type: string | null
  funding_mechanism: string | null
  activity_code: string | null
  fiscal_year: number | null
}

const COMPANY_INDICATORS = ['inc', 'llc', 'corp', 'ltd', 'company', 'co.', 'technologies', 'therapeutics', 'biosciences', 'biotech']
const UNIVERSITY_INDICATORS = ['university', 'college', 'institute of technology', 'school of']
const HOSPITAL_INDICATORS = ['hospital', 'medical center', 'clinic', 'health system']
const RESEARCH_INDICATORS = ['research institute', 'research foundation', 'research center']

function whichCompanyIndicators(name: string): string[] {
  const lower = (name || '').toLowerCase()
  return COMPANY_INDICATORS.filter((ind) => lower.includes(ind))
}
function whichUniversityIndicators(name: string): string[] {
  const lower = (name || '').toLowerCase()
  return UNIVERSITY_INDICATORS.filter((ind) => lower.includes(ind))
}
function whichHospitalIndicators(name: string): string[] {
  const lower = (name || '').toLowerCase()
  return HOSPITAL_INDICATORS.filter((ind) => lower.includes(ind))
}
function whichResearchIndicators(name: string): string[] {
  const lower = (name || '').toLowerCase()
  return RESEARCH_INDICATORS.filter((ind) => lower.includes(ind))
}
function fundingMechanismTriggersCompany(fm: string | null): boolean {
  if (!fm) return false
  const lower = fm.toLowerCase()
  return lower.includes('sbir') || lower.includes('sttr')
}

async function main() {
  console.log('=== Projects classified as "company" whose ORG_NAME contains university/hospital/research-institute markers ===\n')

  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('id, project_number, org_name, org_type, funding_mechanism, activity_code, fiscal_year')
    .eq('org_type', 'company')
    .or('org_name.ilike.%university%,org_name.ilike.%college%,org_name.ilike.%hospital%,org_name.ilike.%medical center%,org_name.ilike.%clinic%,org_name.ilike.%health system%,org_name.ilike.%research institute%,org_name.ilike.%research foundation%,org_name.ilike.%research center%,org_name.ilike.%school of%')
    .order('fiscal_year', { ascending: false })
    .limit(200)

  if (error) {
    console.error('query failed:', error)
    process.exit(1)
  }
  if (!data || data.length === 0) {
    console.log('No misclassified rows found.')
    return
  }

  // Bucket by root cause
  const buckets = {
    sbirSttr: [] as Row[],
    substringCollision: [] as Row[],
    unknown: [] as Row[],
  }
  for (const row of data as Row[]) {
    if (fundingMechanismTriggersCompany(row.funding_mechanism)) {
      buckets.sbirSttr.push(row)
      continue
    }
    const hits = whichCompanyIndicators(row.org_name || '')
    if (hits.length > 0) {
      ;(row as any)._companyHits = hits
      buckets.substringCollision.push(row)
      continue
    }
    buckets.unknown.push(row)
  }

  console.log(`\n=== SBIR/STTR funding mechanism triggering company classification (${buckets.sbirSttr.length}) ===`)
  for (const r of buckets.sbirSttr.slice(0, 10)) {
    console.log(
      `  [${r.fiscal_year} ${r.project_number}] "${r.org_name}" — funding_mechanism="${r.funding_mechanism}", activity=${r.activity_code}`,
    )
  }
  if (buckets.sbirSttr.length > 10) console.log(`  ... + ${buckets.sbirSttr.length - 10} more`)

  console.log(`\n=== Company-indicator substring collision (${buckets.substringCollision.length}) ===`)
  for (const r of buckets.substringCollision.slice(0, 20)) {
    console.log(
      `  [${r.fiscal_year} ${r.project_number}] "${r.org_name}" — hit=${JSON.stringify((r as any)._companyHits)}`,
    )
  }
  if (buckets.substringCollision.length > 20) console.log(`  ... + ${buckets.substringCollision.length - 20} more`)

  console.log(`\n=== Unknown cause — org_name looks like non-company but classified as company without SBIR/STTR or company-indicator match (${buckets.unknown.length}) ===`)
  for (const r of buckets.unknown.slice(0, 20)) {
    console.log(
      `  [${r.fiscal_year} ${r.project_number}] "${r.org_name}" — funding_mechanism="${r.funding_mechanism}", activity=${r.activity_code}`,
    )
  }

  console.log(`\n=== TOTAL: ${data.length} misclassified rows in the top 200 sample ===`)

  // Count fiscal-year distribution to confirm the "new data" hypothesis
  const yearCounts: Record<string, number> = {}
  for (const r of data as Row[]) {
    const y = String(r.fiscal_year ?? 'unknown')
    yearCounts[y] = (yearCounts[y] || 0) + 1
  }
  console.log('\nFiscal-year distribution of misclassifications:')
  for (const [y, c] of Object.entries(yearCounts).sort()) {
    console.log(`  FY${y}: ${c}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
