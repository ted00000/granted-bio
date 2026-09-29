import { supabaseAdmin } from '../src/lib/supabase'

// Find any cell-free antibody-engineering reports and test Option B
// against their whitespace, whether or not they currently render a
// SCOPE WARNING.

const TOPIC_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to',
  'for', 'with', 'by', 'from', 'as', 'is', 'are', 'be', 'this', 'that',
  'these', 'those', 'its', 'their', 'our', 'into', 'using', 'based',
  'via', 'through', 'about', 'over', 'under', 'per',
])
function topicCoreTokens(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[\s,;/()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !TOPIC_STOPWORDS.has(t))
}
const COMPOUND_MARKERS = /\b(and|or|with|combined|combination|versus|vs\.?)\b| \+ /i

async function main() {
  const { data, error } = await supabaseAdmin
    .from('user_reports')
    .select('id, topic, persona, project_count, signals_analysis, agent_outputs, markdown_content, created_at, status')
    .or('topic.ilike.%cell-free%,topic.ilike.%cell free%')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data) {
    console.error('fetch failed:', error)
    process.exit(1)
  }

  console.log(`Found ${data.length} cell-free reports\n`)

  for (const r of data) {
    const ws = ((r.signals_analysis as any)?.whiteSpace
      || (r.agent_outputs as any)?.whiteSpace) as any
    const coreTokens = topicCoreTokens(r.topic)
    const headTerm = coreTokens[0] ?? ''
    const hasScopeWarning = String(r.markdown_content ?? '').includes('SCOPE WARNING')

    console.log(`─── ${r.topic} [${r.id.slice(0,8)}] (${r.persona}, ${r.status}, ${r.created_at.slice(0,10)}) ───`)
    console.log(`  headTerm: "${headTerm}"`)
    console.log(`  has SCOPE WARNING in markdown: ${hasScopeWarning}`)
    if (!ws?.dimensions) { console.log(`  no whitespace\n`); continue }

    const currentFires: Array<{ dim: string; cat: string; broader: number }> = []
    for (const dim of ws.dimensions) {
      for (const cat of dim.categories ?? []) {
        const n = (cat.name as string).toLowerCase()
        if (!n.startsWith(headTerm)) continue
        if (COMPOUND_MARKERS.test(cat.name)) continue
        if (cat.projectCount !== 0) continue
        if ((cat.broaderNihCount ?? 0) < 3) continue
        currentFires.push({ dim: dim.name, cat: cat.name, broader: cat.broaderNihCount ?? 0 })
      }
    }

    // Option B — mirrors evaluateScopeCollapse regex exactly.
    let optionBHit: string | null = null
    const escaped = headTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const headTermPattern = headTerm
      ? new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`, 'i')
      : null
    if (headTermPattern) {
      for (const dim of ws.dimensions) {
        for (const cat of dim.categories ?? []) {
          if ((cat.projectCount ?? 0) <= 0) continue
          if (headTermPattern.test(String(cat.name))) {
            optionBHit = `${dim.name} → "${cat.name}" (${cat.projectCount})`; break
          }
        }
        if (optionBHit) break
      }
    }

    console.log(`  current detector fires: ${currentFires.length}`)
    for (const f of currentFires) console.log(`    - ${f.dim} → "${f.cat}" (broader=${f.broader})`)
    console.log(`  Option B — head term "${headTerm}" in non-zero bucket: ${optionBHit || 'NO'}`)
    if (currentFires.length > 0) {
      console.log(`  → Option B verdict: ${optionBHit ? 'SUPPRESS' : 'STILL FIRE'}`)
    }

    console.log(`  dimensions:`)
    for (const dim of ws.dimensions) {
      const classified = (dim.categories ?? []).reduce((s: number, c: any) => s + (c.projectCount ?? 0), 0)
      console.log(`    ${dim.name}: ${classified}/${r.project_count}`)
      for (const c of dim.categories ?? []) {
        const marker = String(c.name).toLowerCase().includes(headTerm) ? '★' : ' '
        console.log(`      ${marker} ${c.name}: ${c.projectCount ?? 0}`)
      }
    }
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
