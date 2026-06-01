// Test whether the query → embedding pipeline is stable run-to-run.
// If Claude returns different semantic queries OR OpenAI returns different
// embeddings, that fully explains a different top-200 with no data changes.
//
// Run with: npx tsx scripts/test-query-stability.ts

import { config } from 'dotenv'
config({ path: '.env.local' })

const TOPIC = 'Liquid Biopsy For Early Cancer Detection'

const QUERY_SYSTEM_PROMPT = `=== HOW SEARCH WORKS ===
search_projects takes TWO separate queries:
1. keyword_query: For text matching. Use pipes for synonyms: "neural|brain|cerebral organoid|organoids"
2. semantic_query: Natural language for embedding search: "neural organoid platforms for studying brain diseases"

=== QUERY OPTIMIZATION ===
keyword_query: ONLY core scientific terms. Add synonyms with pipes.
- SKIP these generic words: platform, approach, development, research, tools, method, technique, system, application
- These words go in semantic_query only

semantic_query: Full natural language with ALL words including generic ones.

Examples:
- User: "neural organoid platform"
  keyword_query: "neural|brain|cerebral organoid|organoids"
  semantic_query: "neural organoid platforms for brain research and disease modeling"

- User: "CRISPR gene therapy"
  keyword_query: "CRISPR|Cas9 gene therapy|gene editing"
  semantic_query: "CRISPR-based gene therapy approaches for treating genetic diseases"`

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, n1 = 0, n2 = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    n1 += a[i] * a[i]
    n2 += b[i] * b[i]
  }
  return dot / (Math.sqrt(n1) * Math.sqrt(n2))
}

async function main() {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { default: OpenAI } = await import('openai')
  const anthropic = new Anthropic()
  const openai = new OpenAI()

  console.log('\n=== Run buildSemanticQuery 3 times — is Claude\'s output stable? ===')
  const queries: string[] = []
  for (let i = 0; i < 3; i++) {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0,
      system: QUERY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Search for: ${TOPIC}\n\nRespond with JSON only: {"keyword_query": "...", "semantic_query": "..."}`,
        },
      ],
    })
    const text = (r.content[0] as { type: string; text?: string }).text || ''
    try {
      const parsed = JSON.parse(text.trim())
      queries.push(parsed.semantic_query)
      console.log(`  run ${i + 1}: "${parsed.semantic_query}"`)
    } catch {
      console.log(`  run ${i + 1}: parse failed — raw: ${text.slice(0, 200)}`)
    }
  }
  const allEqual = queries.every((q) => q === queries[0])
  console.log(`  semantic_query stable across runs? ${allEqual ? 'YES' : 'NO'}`)

  console.log('\n=== Embed the same string 3 times — is OpenAI\'s embedding stable? ===')
  const sampleQuery = queries[0] || `${TOPIC} research and development`
  const embeddings: number[][] = []
  for (let i = 0; i < 3; i++) {
    const r = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: sampleQuery,
    })
    embeddings.push(r.data[0].embedding)
  }
  const sim01 = cosineSimilarity(embeddings[0], embeddings[1])
  const sim02 = cosineSimilarity(embeddings[0], embeddings[2])
  console.log(`  embedding(run1) vs embedding(run2): cos = ${sim01.toFixed(8)}`)
  console.log(`  embedding(run1) vs embedding(run3): cos = ${sim02.toFixed(8)}`)
  console.log(`  embeddings identical? ${sim01 === 1 && sim02 === 1 ? 'YES' : 'NO (slight drift)'}`)

  // If queries differ between runs, the resulting embeddings will differ.
  // Show the practical impact on cosine similarity.
  if (!allEqual) {
    console.log('\n=== Cross-query embedding similarity (between distinct semantic_query outputs) ===')
    const e1 = (await openai.embeddings.create({ model: 'text-embedding-3-small', input: queries[0] })).data[0].embedding
    for (let i = 1; i < queries.length; i++) {
      if (queries[i] !== queries[0]) {
        const e = (await openai.embeddings.create({ model: 'text-embedding-3-small', input: queries[i] })).data[0].embedding
        const s = cosineSimilarity(e1, e)
        console.log(`  q1 ↔ q${i + 1}: cos = ${s.toFixed(4)}`)
      }
    }
  }
}

main().catch(console.error)
