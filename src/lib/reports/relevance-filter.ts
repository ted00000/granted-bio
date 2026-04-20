// Topic Relevance Filter
// Filters items (trials, patents, publications) to ensure they're actually relevant to the report topic
// Uses AI to batch-evaluate relevance, preventing unrelated items from appearing in reports

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

interface FilterableItem {
  id: string
  title: string
  description?: string | null
}

interface FilterResult {
  kept: string[]
  removed: string[]
}

/**
 * Filter items for topic relevance using AI
 * Returns IDs of items that are actually relevant to the topic
 *
 * @param topic - The report topic (e.g., "monoclonal antibody production")
 * @param items - Items to filter, each with id, title, and optional description
 * @param itemType - Type of items for logging (e.g., "trials", "patents", "publications")
 * @returns Object with arrays of kept and removed item IDs
 */
export async function filterForRelevance(
  topic: string,
  items: FilterableItem[],
  itemType: string
): Promise<FilterResult> {
  if (items.length === 0) {
    return { kept: [], removed: [] }
  }

  // For small batches, filter all at once
  // For larger batches, process in chunks to stay within context limits
  const BATCH_SIZE = 30
  const allKept: string[] = []
  const allRemoved: string[] = []

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    const result = await filterBatch(topic, batch, itemType)
    allKept.push(...result.kept)
    allRemoved.push(...result.removed)
  }

  console.log(`[Relevance Filter] ${itemType}: kept ${allKept.length}/${items.length} items`)

  return { kept: allKept, removed: allRemoved }
}

/**
 * Filter a single batch of items
 */
async function filterBatch(
  topic: string,
  items: FilterableItem[],
  itemType: string
): Promise<FilterResult> {
  // Build the items list for the prompt
  const itemsList = items.map((item, idx) => {
    const desc = item.description ? ` - ${item.description.slice(0, 200)}` : ''
    return `${idx + 1}. [${item.id}] ${item.title}${desc}`
  }).join('\n')

  const prompt = `You are filtering ${itemType} for a research report about "${topic}".

Review each item below and determine if it is DIRECTLY RELEVANT to the topic "${topic}".

An item is relevant if:
- It directly involves or advances the topic
- It studies applications or methods core to the topic
- It would be valuable information for someone researching this specific topic

An item is NOT relevant if:
- It only tangentially mentions or uses the topic as a tool/component
- It's about a completely different subject
- The connection to the topic is incidental or peripheral

Items to evaluate:
${itemsList}

Respond with ONLY a JSON object in this exact format:
{"relevant": ["id1", "id2", ...], "not_relevant": ["id3", "id4", ...]}

Include ALL item IDs in your response, categorized as either relevant or not_relevant.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`[Relevance Filter] Failed to parse response for ${itemType}, keeping all items`)
      return { kept: items.map(i => i.id), removed: [] }
    }

    const parsed = JSON.parse(jsonMatch[0]) as { relevant: string[], not_relevant: string[] }

    return {
      kept: parsed.relevant || [],
      removed: parsed.not_relevant || [],
    }
  } catch (error) {
    console.error(`[Relevance Filter] Error filtering ${itemType}:`, error)
    // On error, keep all items rather than losing data
    return { kept: items.map(i => i.id), removed: [] }
  }
}

/**
 * Quick relevance check using keyword matching
 * Use this for pre-filtering before AI-based filtering to reduce costs
 * Returns true if the item likely relates to the topic
 */
export function quickRelevanceCheck(topic: string, title: string, description?: string | null): boolean {
  const topicLower = topic.toLowerCase()
  const textToCheck = `${title} ${description || ''}`.toLowerCase()

  // Extract key terms from the topic
  const topicWords = topicLower
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !['and', 'the', 'for', 'with', 'from'].includes(w))

  // Check if any topic words appear in the text
  const matchCount = topicWords.filter(word => textToCheck.includes(word)).length

  // Require at least 40% of topic words to match
  return matchCount >= Math.ceil(topicWords.length * 0.4)
}
