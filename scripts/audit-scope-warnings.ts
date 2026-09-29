import { supabaseAdmin } from '../src/lib/supabase'

// Pull every report whose markdown contains a SCOPE WARNING blockquote,
// dump the head-term-zero-bucket candidates and check Option B (head-term
// substring presence in any non-zero category name across dimensions).

interface Category { name: string; projectCount?: number; broaderNihCount?: number }
interface Dimension { name: string; categories?: Category[] }
interface WhiteSpace { dimensions?: Dimension[] }

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
    .select('id, topic, persona, project_count, signals_analysis, agent_outputs, markdown_content, created_at')
    .eq('status', 'complete')
    .ilike('markdown_content', '%SCOPE WARNING%')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !data) {
    console.error('fetch failed:', error)
    process.exit(1)
  }

  console.log(`Found ${data.length} reports with SCOPE WARNING in markdown\n`)

  for (const r of data) {
    const ws = ((r.signals_analysis as any)?.whiteSpace
      || (r.agent_outputs as any)?.whiteSpace) as WhiteSpace | undefined
    if (!ws?.dimensions) {
      console.log(`- ${r.topic} [${r.id.slice(0,8)}] — no whitespace, skip`)
      continue
    }

    const coreTokens = topicCoreTokens(r.topic)
    const headTerm = coreTokens[0] ?? ''

    // Emulate the current head-term-zero-bucket detector
    const currentFires: Array<{ dimension: string; category: string; broader: number }> = []
    for (const dim of ws.dimensions) {
      for (const cat of dim.categories ?? []) {
        const n = cat.name.toLowerCase()
        if (!n.startsWith(headTerm)) continue
        if (COMPOUND_MARKERS.test(cat.name)) continue
        if (cat.projectCount !== 0) continue
        if ((cat.broaderNihCount ?? 0) < 3) continue
        currentFires.push({ dimension: dim.name, category: cat.name, broader: cat.broaderNihCount ?? 0 })
      }
    }

    // Option B: does the head term appear anywhere in a NON-ZERO
    // category name across all dimensions? Uses word-boundary matching
    // that treats alphanumerics + hyphens as connective — mirrors the
    // regex in evaluateScopeCollapse exactly.
    let headTermInNonZeroBucket: string | null = null
    const escaped = headTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const headTermPattern = headTerm
      ? new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`, 'i')
      : null
    if (headTermPattern) {
      for (const dim of ws.dimensions) {
        for (const cat of dim.categories ?? []) {
          if ((cat.projectCount ?? 0) <= 0) continue
          if (headTermPattern.test(cat.name)) {
            headTermInNonZeroBucket = `${dim.name} → "${cat.name}" (${cat.projectCount})`
            break
          }
        }
        if (headTermInNonZeroBucket) break
      }
    }

    // Dimension coverage (for Option A comparison)
    const dimCoverage = ws.dimensions.map(d => {
      const classified = (d.categories ?? []).reduce((s, c) => s + (c.projectCount ?? 0), 0)
      return { name: d.name, classified, total: r.project_count ?? 0, pct: r.project_count ? classified / r.project_count : 0 }
    })

    console.log(`─── ${r.topic} [${r.id.slice(0,8)}] (${r.persona}, ${r.project_count} projects, ${r.created_at.slice(0,10)}) ───`)
    console.log(`  headTerm: "${headTerm}"`)
    console.log(`  current detector fires: ${currentFires.length}`)
    for (const f of currentFires) {
      console.log(`    - ${f.dimension} → "${f.category}" (broader=${f.broader})`)
    }
    console.log(`  Option B — head term in non-zero bucket: ${headTermInNonZeroBucket ? 'YES → ' + headTermInNonZeroBucket : 'NO'}`)
    console.log(`  → Option B verdict: ${currentFires.length > 0 && headTermInNonZeroBucket ? 'SUPPRESS (was firing, now silent)' : currentFires.length > 0 ? 'STILL FIRE (was firing, still fires)' : 'no head-term-zero-bucket fire either way'}`)
    console.log(`  dimension coverage:`)
    for (const d of dimCoverage) {
      console.log(`    - ${d.name}: ${d.classified}/${d.total} (${(d.pct*100).toFixed(0)}%)`)
    }
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
