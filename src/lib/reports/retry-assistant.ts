// AI-assisted retry interpretation generator.
//
// Called when a user is dissatisfied with a generated report and asks for
// a retry. Claude looks at the original interpretation, the top projects
// that surfaced (or didn't), and the user's complaint, and proposes three
// reformulated interpretations the user can choose from before consuming
// their retry credit.
//
// Failure modes the assistant handles by design:
//   - "projects_wrong"   → reformulate semanticQuery to target the user's
//                          actual area of interest, NOT just narrow/broaden
//   - "too_narrow"       → broaden semanticQuery + keywordQuery scope
//   - "too_broad"        → tighten to a more specific subdomain
//   - "missed_aspect"    → reformulate to include the named angle
//   - "wrong_field"      → reformulate from a different domain framing
//
// Cost: roughly one Sonnet call per retry, ~$0.02. Negligible against the
// $199 purchase.

import type { InjectedInterpretation } from './generate'

export interface RetryProposal {
  label: string
  semanticQuery: string
  keywordQuery: string
  rationale: string
}

export type RetryFeedbackCategory =
  | 'projects_wrong'
  | 'too_narrow'
  | 'too_broad'
  | 'missed_aspect'
  | 'wrong_field'

const CATEGORY_HINTS: Record<RetryFeedbackCategory, string> = {
  projects_wrong:
    'The projects that surfaced were not what the user was looking for. They probably want a different angle on the same broad topic.',
  too_narrow:
    'The search was too narrow. The user wants more inclusive scope — adjacent areas, broader concepts, alternative analyte / method / approach families.',
  too_broad:
    'The search was too broad. The user wants tighter focus — narrower subdomain, more specific technical scope, fewer adjacent areas.',
  missed_aspect:
    'A specific aspect the user cares about was missed. Re-frame the semantic query so that aspect becomes central.',
  wrong_field:
    'The wrong research field surfaced. Re-frame the topic from a different domain entirely. Lean on the user feedback text to identify which field.',
}

export async function retryAssistantInterpretation(params: {
  originalTopic: string
  originalInterpretation: InjectedInterpretation | null
  topProjectTitles: string[]
  feedbackCategory: RetryFeedbackCategory
  feedbackText: string | null
}): Promise<RetryProposal[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  const originalLabel = params.originalInterpretation?.label ?? '(no picker — legacy)'
  const originalSemantic =
    params.originalInterpretation?.semanticQuery ?? params.originalTopic
  const originalKeyword = params.originalInterpretation?.keywordQuery ?? params.originalTopic

  const projectsBlock =
    params.topProjectTitles.length > 0
      ? params.topProjectTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(no project titles available — report may have failed before any results returned)'

  const categoryHint = CATEGORY_HINTS[params.feedbackCategory]

  const prompt = `You're refining a research-intelligence search query. A user generated a report but wasn't happy with the results. Propose three reformulated interpretations they can pick from before retrying.

## ORIGINAL TOPIC
${params.originalTopic}

## ORIGINAL INTERPRETATION USED
- Label: ${originalLabel}
- Semantic query: "${originalSemantic}"
- Keyword query: "${originalKeyword}"

## TOP PROJECTS THAT SURFACED IN THE ORIGINAL
${projectsBlock}

## WHAT THE USER SAID WAS WRONG
- Category: ${params.feedbackCategory}
- Category-specific hint: ${categoryHint}
${params.feedbackText ? `- Free-text feedback: "${params.feedbackText}"` : '- (no free-text feedback provided)'}

## YOUR TASK
Propose THREE reformulated interpretations. Each should attempt to solve the user's complaint in a meaningfully different way — not three tiny variations of the same idea.

Each proposal has four fields:
- label: a short human-readable name (2-4 words, like "Methylation-Focused" or "Broader MCED Field")
- semanticQuery: a natural-language phrase (10-25 words) that will be embedded for vector search. Should be substantive prose, not a list of keywords.
- keywordQuery: pipe-separated keywords (5-10 terms) used for picker UI display chips. Most specific terms first.
- rationale: one sentence explaining why this reformulation might address the user's complaint.

FORMATTING:
- Do NOT use em dashes. Use regular hyphens.
- Output ONLY the JSON object below — no preamble, no markdown fence, no commentary outside the JSON.

{
  "proposals": [
    { "label": "...", "semanticQuery": "...", "keywordQuery": "term1|term2|term3", "rationale": "..." },
    { "label": "...", "semanticQuery": "...", "keywordQuery": "term1|term2|term3", "rationale": "..." },
    { "label": "...", "semanticQuery": "...", "keywordQuery": "term1|term2|term3", "rationale": "..." }
  ]
}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return []
  }

  // Strip markdown fences + extract JSON object — matches the defensive
  // pattern used by every other JSON parser in this codebase.
  let jsonText = textBlock.text.trim()
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
  }
  const match = jsonText.match(/\{[\s\S]*\}/)
  if (!match) {
    console.warn('[retry-assistant] No JSON object found in Claude response')
    return []
  }

  try {
    const parsed = JSON.parse(match[0]) as { proposals?: unknown }
    if (!parsed.proposals || !Array.isArray(parsed.proposals)) return []

    const proposals: RetryProposal[] = []
    for (const raw of parsed.proposals) {
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as { label?: unknown }).label === 'string' &&
        typeof (raw as { semanticQuery?: unknown }).semanticQuery === 'string' &&
        typeof (raw as { keywordQuery?: unknown }).keywordQuery === 'string' &&
        typeof (raw as { rationale?: unknown }).rationale === 'string'
      ) {
        const p = raw as RetryProposal
        proposals.push({
          label: p.label.trim(),
          semanticQuery: p.semanticQuery.trim(),
          keywordQuery: p.keywordQuery.trim(),
          rationale: p.rationale.trim(),
        })
      }
    }
    return proposals.slice(0, 3)
  } catch (e) {
    console.error('[retry-assistant] Failed to parse Claude proposals:', e)
    return []
  }
}
