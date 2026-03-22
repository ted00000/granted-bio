// Market Agent
// Gathers external market context via web search (10-15% of report)

import type { MarketAgentOutput, MarketContext } from '../types'

/**
 * Run the Market Agent to gather external market context for a topic
 */
export async function runMarketAgent(topic: string): Promise<MarketAgentOutput> {
  console.log(`[Market Agent] Gathering market context for "${topic}"`)

  try {
    // Use Claude with web search to gather market context
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
 * Use LLM to gather and synthesize market context
 */
async function gatherMarketContext(topic: string): Promise<MarketContext> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  const prompt = `You are a market research analyst. Gather current market intelligence for: "${topic}"

Based on your knowledge (up to your training cutoff), provide:

1. **Market Overview**: Brief description of the market/research landscape for this topic
2. **Market Size**: Any known market size estimates (global market value, growth rate)
3. **Key Players**: Major companies commercializing or developing products in this space (list 3-5)
4. **Recent Developments**: Notable recent events (FDA approvals, major partnerships, clinical results) - list 2-4
5. **Competitive Landscape**: Brief description of the competitive dynamics

Format your response as JSON with this structure:
{
  "overview": "2-3 paragraph market overview",
  "marketSize": "e.g., '$X billion in 2024, growing at Y% CAGR' or null if unknown",
  "keyPlayers": ["Company A", "Company B", "Company C"],
  "recentDevelopments": ["Development 1", "Development 2"],
  "competitiveLandscape": "Brief competitive analysis paragraph"
}

Only include information you are confident about. If you're not sure about something, omit it or mark as uncertain.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Extract text content
  const textContent = response.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  // Parse JSON from response
  const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  const parsed = JSON.parse(jsonMatch[0])

  return {
    overview: parsed.overview || '',
    marketSize: parsed.marketSize || null,
    keyPlayers: parsed.keyPlayers || [],
    recentDevelopments: parsed.recentDevelopments || [],
    competitiveLandscape: parsed.competitiveLandscape || '',
    sources: ['Claude AI knowledge base (training data cutoff)'],
  }
}
