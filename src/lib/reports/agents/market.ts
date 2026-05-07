// Market Agent
// Gathers external market context via Claude's web_search tool (10-15% of report)
// Replaces the prior training-data-only approach with live, sourced web research.

import Anthropic from '@anthropic-ai/sdk'
import type { MarketAgentOutput, MarketContext } from '../types'

const anthropic = new Anthropic()

/**
 * Run the Market Agent to gather external market context for a topic.
 * Uses Claude's server-side web_search tool for current, sourced information.
 */
export async function runMarketAgent(topic: string): Promise<MarketAgentOutput> {
  console.log(`[Market Agent] Gathering market context for "${topic}"`)

  try {
    const context = await gatherMarketContext(topic)
    return { context }
  } catch (error) {
    console.error('[Market Agent] Error:', error)
    return {
      context: {
        overview: `Market context for ${topic} could not be retrieved.`,
        marketSize: null,
        keyPlayers: [],
        recentDevelopments: [],
        competitiveLandscape: '',
        sources: [],
      },
    }
  }
}

/**
 * Use Claude with web_search to gather current, cited market intelligence.
 * Sources are extracted from the actual URLs the model retrieved.
 */
async function gatherMarketContext(topic: string): Promise<MarketContext> {
  const today = new Date().toISOString().split('T')[0]

  const prompt = `You are a life-sciences market research analyst. Today is ${today}.

Use the web_search tool to gather CURRENT market intelligence for: "${topic}"

Run multiple searches as needed to verify and triangulate facts. Search for:
1. Recent market size estimates (cite year and source)
2. Key commercial players (companies developing or commercializing this technology)
3. Recent notable events from the last 12-24 months (FDA approvals, fundings, M&A, partnerships, clinical readouts)
4. Competitive dynamics

Prefer sources from the last 2 years. Industry reports, reputable trade press, company announcements, and FDA/regulatory filings are all valid.

After searching, return your analysis as JSON with this exact structure:

{
  "overview": "2-3 paragraph market overview synthesized from search results",
  "marketSize": "See MARKET SIZING RULES below — either a direct estimate, an explicitly-labeled adjacent-market anchor, or null",
  "keyPlayers": ["Company A", "Company B", "Company C"],
  "recentDevelopments": ["YYYY-MM: brief description of development", "YYYY-MM: brief description"],
  "competitiveLandscape": "Brief paragraph describing competitive dynamics"
}

MARKET SIZING RULES (be strict):

The marketSize field must follow exactly ONE of three patterns:

1. **Direct estimate** — when a reputable source has sized THIS topic specifically:
   "$X billion in YYYY, projected to $Y by YYYY at Z% CAGR (Source Name, Year)"

2. **Adjacent-market anchor** — when this topic is not separately tracked, but the parent or adjacent market is. Lead with the framing so it's clear:
   "Direct sizing for [topic] is not separately tracked. The closest adjacent market is [parent market name]: $X billion in YYYY (Source, Year). [Optional: one more anchor if it adds clarity.]"

3. **null** — when no reliable figure exists for either the topic or a clearly-related adjacent market.

PROHIBITED PATTERNS (do NOT do these):
- Do NOT speculate about what fraction of a parent market this topic represents (no "meaningful but unquantified fraction" language)
- Do NOT stitch together multiple sources that disagree (e.g., "$1.5-1.86 billion ... $6.27-9.6 billion") — this looks made up. If sources disagree materially, pick the most recent reputable one and cite it; otherwise use null.
- Do NOT include figures from sources you haven't verified via search
- Do NOT pad with caveats — the framing above is sufficient

OTHER RULES:
- Only include information you actually found via search.
- Each entry in recentDevelopments must be prefixed with YYYY-MM for transparency about recency.
- If search returned no useful information for a field, use null or [].
- FORMATTING: Do NOT use em dashes. Use regular hyphens.

Return ONLY the JSON object — no preamble, no markdown code fence, no explanation outside the JSON.`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
      },
    ],
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Extract URLs from web_search_tool_result blocks (used as sources)
  const sources: string[] = []
  for (const block of response.content) {
    // The web_search_tool_result block type is dynamically added by the API
    if (block.type === 'web_search_tool_result') {
      // Type is loosely-typed in the SDK for server tools — cast and inspect
      const result = block as unknown as { content?: Array<{ url?: string; type?: string }> }
      if (Array.isArray(result.content)) {
        for (const r of result.content) {
          if (r.url && typeof r.url === 'string') sources.push(r.url)
        }
      }
    }
  }

  // The final text block contains the JSON answer (model may produce intermediate text between searches)
  const textBlocks = response.content.filter((b) => b.type === 'text')
  const finalText = textBlocks[textBlocks.length - 1]
  if (!finalText || finalText.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  // Strip markdown code fences if present, then extract JSON object
  let jsonText = finalText.text.trim()
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```(?:json)?\n?/g, '').replace(/\n?```$/g, '').trim()
  }
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  const parsed = JSON.parse(jsonMatch[0])

  // Dedupe sources and cap at 10
  const uniqueSources = Array.from(new Set(sources)).slice(0, 10)

  console.log(
    `[Market Agent] Used web_search; collected ${uniqueSources.length} sources, ` +
    `${parsed.keyPlayers?.length || 0} key players, ${parsed.recentDevelopments?.length || 0} recent developments`
  )

  return {
    overview: parsed.overview || '',
    marketSize: parsed.marketSize || null,
    keyPlayers: Array.isArray(parsed.keyPlayers) ? parsed.keyPlayers : [],
    recentDevelopments: Array.isArray(parsed.recentDevelopments) ? parsed.recentDevelopments : [],
    competitiveLandscape: parsed.competitiveLandscape || '',
    sources: uniqueSources,
  }
}
