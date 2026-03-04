// Patents Agent
// Searches patents linked to NIH projects
// Note: USPTO PatentsView API is currently suspended, so we use existing data only

import { supabaseAdmin } from '@/lib/supabase'
import type { PatentsAgentOutput, PatentItem } from '../types'

/**
 * Run the Patents Agent to gather patent data for a topic
 */
export async function runPatentsAgent(topic: string): Promise<PatentsAgentOutput> {
  console.log(`[Patents Agent] Searching for "${topic}"`)

  // Generate embedding for semantic search
  const queryEmbedding = await generateEmbedding(topic)

  // Run hybrid search: semantic + keyword
  const queryWords = topic
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)

  const [semanticResult, keywordResult] = await Promise.all([
    // Semantic search
    supabaseAdmin.rpc('search_patents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: 30,
    }),
    // Keyword search on title
    supabaseAdmin
      .from('patents')
      .select(
        'patent_id, patent_title, patent_abstract, patent_date, assignees, inventors, project_number'
      )
      .or(queryWords.map((word) => `patent_title.ilike.%${word}%`).join(','))
      .limit(30),
  ])

  // Merge results, prioritizing semantic matches
  const seenIds = new Set<string>()
  const rawResults: RawPatentResult[] = []

  // Add semantic results first
  if (semanticResult.data) {
    for (const patent of semanticResult.data as RawPatentResult[]) {
      if (!seenIds.has(patent.patent_id)) {
        seenIds.add(patent.patent_id)
        rawResults.push(patent)
      }
    }
  }

  // Add keyword results that weren't in semantic results
  if (keywordResult.data) {
    for (const patent of keywordResult.data as RawPatentResult[]) {
      if (!seenIds.has(patent.patent_id)) {
        seenIds.add(patent.patent_id)
        rawResults.push(patent)
      }
    }
  }

  // Limit to top 30
  const results = rawResults.slice(0, 30)

  return processResults(results)
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawPatentResult[]): PatentsAgentOutput {
  // Map to PatentItem format
  const items: PatentItem[] = rawResults.map((p) => ({
    patent_id: p.patent_id,
    patent_title: p.patent_title || null,
    patent_abstract: p.patent_abstract || null,
    assignee: Array.isArray(p.assignees) ? p.assignees[0] : null,
    patent_date: p.patent_date || null,
    inventors: Array.isArray(p.inventors) ? p.inventors.join(', ') : null,
  }))

  // Group by assignee
  const assigneeMap = new Map<string, number>()
  items.forEach((p) => {
    if (!p.assignee) return
    assigneeMap.set(p.assignee, (assigneeMap.get(p.assignee) || 0) + 1)
  })
  const byAssignee = Array.from(assigneeMap.entries())
    .map(([assignee, count]) => ({ assignee, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Count recent patents (last 2 years)
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const recentCount = items.filter((p) => {
    if (!p.patent_date) return false
    return new Date(p.patent_date) >= twoYearsAgo
  }).length

  console.log(`[Patents Agent] Found ${items.length} patents (${recentCount} recent)`)

  return {
    items,
    byAssignee,
    recentCount,
  }
}

/**
 * Return empty output when search fails
 */
function emptyOutput(): PatentsAgentOutput {
  return {
    items: [],
    byAssignee: [],
    recentCount: 0,
  }
}

/**
 * Generate embedding using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI()

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}

// Type for raw database results
interface RawPatentResult {
  patent_id: string
  patent_title?: string | null
  patent_abstract?: string | null
  patent_date?: string | null
  assignees?: string[] | null
  inventors?: string[] | null
  project_number?: string | null
}
