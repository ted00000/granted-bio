import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import Anthropic from '@anthropic-ai/sdk'
import { checkProjectCount } from '@/lib/reports/generate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One Claude call returns three scoped interpretations of the user's topic
// (Narrow / Standard / Broad). The user picks one before report generation
// runs, so the rest of the pipeline is anchored on a known, human-confirmed
// semantic query.
//
// Enhanced 2026-08-06 with pre-flight preview: after generating the three
// interpretations we (a) run three parallel semantic-count queries so the
// user sees empirical yield per interpretation and (b) make a second small
// Claude call that critiques the trade-offs with counts + persona in
// context and picks a recommended default. The intent is to replicate the
// "I'll help you pick" exchange a human would have when the interpretations
// look ambiguous. Adds ~2-3s to the step; UI copy updated accordingly.

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

// Second-pass critique prompt. Called after we have the three interpretations
// AND their empirical project counts. Sonnet gets the actual yield numbers
// plus the user's persona so it can reason like a human helper would.
//
// HARD length cap enforced in the prompt because Sonnet ignores "2-4
// sentences" left-loose and can spill into 8+ sentence essays that overflow
// the dialog. Word budget is a stronger signal than sentence count.
//
// Close-count guidance: when narrow/standard/broad return counts within
// ~10% of each other, the raw number is noise (semantic search is
// picking up the same core pool with different edge cases). In that
// regime the recommendation should hinge on VOCABULARY QUALITY and
// PERSONA FIT, not "narrow returned 5 more, pick narrow." Baking this
// into the prompt because Sonnet was defaulting to raw-count reasoning
// and picking narrow when standard was the better semantic match.
const CRITIQUE_PROMPT = `A user is about to generate a paid intelligence report on their topic. Three search interpretations have been generated and we ran the semantic-search yield for each. Help the user pick.

User topic: "{topic}"
Persona: {persona}

Interpretations with empirical project yield:
{interpretationsWithCounts}

Write a critique that helps the user choose. Reasoning heuristics:

1. Count deltas within ~10% of each other are NOISE, not signal. Do not recommend based on "X yields 5 more projects than Y." When counts are close, decide on VOCABULARY QUALITY and PERSONA FIT.

2. Persona-specific priors:
   - RESEARCHER: Usually pick STANDARD when it uses the field's actual technical vocabulary (e.g. ctDNA/cfDNA for liquid biopsy, PSMA/lutetium for radiopharmaceuticals, MERFISH/Visium for spatial transcriptomics). Researchers search using those terms; a report anchored on them matches how the audience thinks. NARROW only wins when the topic is already a precise field term.
   - INVESTOR: Usually pick STANDARD for commercial industry vocabulary (what deal-flow announcements and pitch decks use). BROAD only when the user's topic is clearly a category rather than a specific modality and they need adjacent-technology context for market sizing.

3. Only recommend NARROW when the user's phrasing is already the community-standard technical term AND expanding it would dilute results. Only recommend BROAD when the topic is genuinely a category label and the user needs adjacent-market context.

4. If a specific vocabulary mismatch exists (e.g. user says "radiopharmaceuticals" but Novartis markets Pluvicto as "radioligand therapy"), flag it in one clause.

HARD LIMIT: maximum 3 sentences OR 60 words, whichever is shorter. Direct, no hedging, no throat-clearing ("It's worth noting that...", "One should consider..."). Just the reasoning + the pick.

Return ONLY this JSON object, no markdown code fences, no em dashes:
{
  "critique": "...",
  "recommendedId": "narrow" | "standard" | "broad"
}`

interface Interpretation {
  id: 'narrow' | 'standard' | 'broad'
  label: string
  description: string
  semanticQuery: string
  keywordQuery: string
}

interface EnrichedInterpretation extends Interpretation {
  projectCount: number | null
}

function stripFencesAndExtractJson(text: string): string | null {
  let raw = text.trim()
  if (raw.startsWith('```')) {
    raw = raw.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim()
  }
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : null
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
    const persona: 'researcher' | 'investor' =
      body.persona === 'investor' ? 'investor' : 'researcher'
    if (!topic) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 })
    }

    const client = new Anthropic()

    // Pass 1: interpretations. Haiku 4.5 is used here because the task is
    // largely structured generation (three JSON entries in fixed scope
    // buckets) that doesn't need Sonnet's domain-reasoning depth. Sonnet
    // at 10.7s vs Haiku at 3.2s in local smoke tests (2026-08-06). The
    // trade-off in interpretation quality was not perceptible in blind
    // comparison across ~5 topics. If quality regresses, promote to
    // claude-sonnet-4-6.
    const interpretResponse = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: INTERPRET_PROMPT.replace('{topic}', topic) }],
    })

    const interpretText = interpretResponse.content.find((b) => b.type === 'text')
    if (!interpretText || interpretText.type !== 'text') {
      return NextResponse.json(
        { error: 'No text response from interpretation step' },
        { status: 500 }
      )
    }

    const interpretJson = stripFencesAndExtractJson(interpretText.text)
    if (!interpretJson) {
      return NextResponse.json(
        { error: 'Failed to parse interpretations', raw: interpretText.text.slice(0, 300) },
        { status: 500 }
      )
    }

    let parsed: { interpretations?: Interpretation[] }
    try {
      parsed = JSON.parse(interpretJson)
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

    // Pass 2 setup: run three parallel semantic counts. We pass a 500
    // matchCount cap (vs the default 100) because the preview needs real
    // differentiation between interpretations, not just a >5 vs <5 gate.
    // Any that fail resolve to null so the UI can show "-" without
    // breaking the whole preview.
    const PREVIEW_COUNT_CAP = 500
    const counts = await Promise.all(
      items.map(async (it) => {
        try {
          return await checkProjectCount(it.semanticQuery, PREVIEW_COUNT_CAP)
        } catch (e) {
          console.error(`[interpret-topic] count failed for ${it.id}:`, e)
          return null
        }
      })
    )

    const enriched: EnrichedInterpretation[] = items.map((it, i) => ({
      ...it,
      projectCount: counts[i],
    }))

    // Pass 3: critique + recommendation. Non-blocking: if this fails we
    // still return the interpretations with counts and let the UI render
    // without the extra guidance.
    let critique: string | null = null
    let recommendedId: 'narrow' | 'standard' | 'broad' | null = null

    try {
      const interpretationsWithCounts = enriched
        .map(
          (it) =>
            `- ${it.label} ("${it.semanticQuery}"): ${
              it.projectCount === null ? 'count unavailable' : `${it.projectCount} projects`
            }`
        )
        .join('\n')

      // Sonnet is used here (vs Haiku for pass 1) because the critique is
      // the actual judgment step: knowing which term the industry uses,
      // reasoning about persona fit, weighing count deltas. Haiku
      // produces plausible-but-generic critiques on this in blind test
      // (e.g. missed that Novartis calls Pluvicto "radioligand therapy").
      const critiqueResponse = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: CRITIQUE_PROMPT.replace('{topic}', topic)
              .replace('{persona}', persona)
              .replace('{interpretationsWithCounts}', interpretationsWithCounts),
          },
        ],
      })

      const critiqueText = critiqueResponse.content.find((b) => b.type === 'text')
      if (critiqueText && critiqueText.type === 'text') {
        const critiqueJson = stripFencesAndExtractJson(critiqueText.text)
        if (critiqueJson) {
          const critiqueParsed = JSON.parse(critiqueJson) as {
            critique?: unknown
            recommendedId?: unknown
          }
          if (typeof critiqueParsed.critique === 'string') {
            critique = critiqueParsed.critique.trim()
          }
          if (
            critiqueParsed.recommendedId === 'narrow' ||
            critiqueParsed.recommendedId === 'standard' ||
            critiqueParsed.recommendedId === 'broad'
          ) {
            recommendedId = critiqueParsed.recommendedId
          }
        }
      }
    } catch (e) {
      console.error('[interpret-topic] critique step failed (non-fatal):', e)
    }

    return NextResponse.json({
      interpretations: enriched,
      critique,
      recommendedId,
    })
  } catch (error) {
    console.error('[interpret-topic] error:', error)
    return NextResponse.json(
      { error: 'Failed to generate interpretations', details: String(error) },
      { status: 500 }
    )
  }
}
