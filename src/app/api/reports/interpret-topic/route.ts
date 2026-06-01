import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One Claude call returns three scoped interpretations of the user's topic
// (Narrow / Standard / Broad). The user picks one before report generation
// runs, so the rest of the pipeline is anchored on a known, human-confirmed
// semantic query — eliminating the Claude-rewrite drift that previously
// caused identical topics to produce non-reproducible report results.

const INTERPRET_PROMPT = `Given a research topic, generate exactly 3 distinct search interpretations that vary in scope.

Topic: "{topic}"

Generate three interpretations:

1. NARROW — Search the topic literally with minimal expansion.
   - semanticQuery: the user's topic as a natural-language phrase, lightly cleaned (case/grammar) but not expanded
   - keywordQuery: just the core terms with pluralization (use pipes for plurals: "term|terms")
   - description: short user-facing label, e.g. "The exact topic, no expansion"

2. STANDARD — Topic plus direct synonyms and common scientific aliases.
   - semanticQuery: natural-language phrase including the topic plus standard expansions, e.g. "liquid biopsy and ctDNA approaches for early cancer detection"
   - keywordQuery: pipe-separated synonyms, e.g. "liquid biopsy|ctDNA|cfDNA|cell-free DNA"
   - description: short user-facing label, e.g. "Common synonyms and aliases included"

3. BROAD — Topic plus adjacent technologies, related methodologies, and conceptually neighboring approaches.
   - semanticQuery: longer phrase including the topic plus related concepts
   - keywordQuery: extended pipe-separated synonym list including adjacent terms
   - description: short user-facing label, e.g. "Adjacent technologies and broader neighborhood"

Rules:
- Each interpretation must be meaningfully distinct in scope.
- Do not invent unrelated terms. Stay within the conceptual neighborhood of the user's topic.
- semanticQuery is natural language for embedding search.
- keywordQuery is pipe-separated tokens for text matching.
- description is one short sentence the user will read in the picker UI.
- Do NOT use em dashes; use regular hyphens.

Return ONLY this JSON object, no markdown code fences:
{
  "interpretations": [
    { "id": "narrow",   "label": "Narrow",   "description": "...", "semanticQuery": "...", "keywordQuery": "..." },
    { "id": "standard", "label": "Standard", "description": "...", "semanticQuery": "...", "keywordQuery": "..." },
    { "id": "broad",    "label": "Broad",    "description": "...", "semanticQuery": "...", "keywordQuery": "..." }
  ]
}`

interface Interpretation {
  id: 'narrow' | 'standard' | 'broad'
  label: string
  description: string
  semanticQuery: string
  keywordQuery: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (!topic) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 })
    }

    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: INTERPRET_PROMPT.replace('{topic}', topic) }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from interpretation step' },
        { status: 500 }
      )
    }

    // Strip optional markdown code fences then extract JSON object
    let raw = textBlock.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Failed to parse interpretations', raw: raw.slice(0, 300) },
        { status: 500 }
      )
    }

    let parsed: { interpretations?: Interpretation[] }
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e) {
      return NextResponse.json(
        { error: 'Failed to parse interpretations JSON', details: String(e) },
        { status: 500 }
      )
    }

    const items = parsed.interpretations
    if (!Array.isArray(items) || items.length !== 3) {
      return NextResponse.json(
        { error: 'Expected exactly 3 interpretations', received: items?.length ?? 0 },
        { status: 500 }
      )
    }

    // Validate shape and order (narrow / standard / broad)
    const expectedIds = ['narrow', 'standard', 'broad'] as const
    for (let i = 0; i < 3; i++) {
      const it = items[i]
      if (
        !it ||
        it.id !== expectedIds[i] ||
        typeof it.semanticQuery !== 'string' ||
        typeof it.keywordQuery !== 'string' ||
        typeof it.description !== 'string' ||
        typeof it.label !== 'string'
      ) {
        return NextResponse.json(
          { error: 'Malformed interpretation entry', index: i },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ interpretations: items })
  } catch (error) {
    console.error('[interpret-topic] error:', error)
    return NextResponse.json(
      { error: 'Failed to generate interpretations', details: String(error) },
      { status: 500 }
    )
  }
}
