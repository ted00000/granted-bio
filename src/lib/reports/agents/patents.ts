// Patents Agent
// Searches patents linked to NIH projects
// Uses hybrid approach: keyword search + project-linked search

import { supabaseAdmin } from '@/lib/supabase'
import type { PatentsAgentOutput, PatentItem } from '../types'

const UNIFIED_THRESHOLD = 0.35

/**
 * Run the Patents Agent to gather patent data for a topic
 * Uses hybrid approach: keyword search + project-linked search
 */
export async function runPatentsAgent(topic: string): Promise<PatentsAgentOutput> {
  console.log(`[Patents Agent] Searching for "${topic}"`)

  const queryEmbedding = await generateEmbedding(topic)

  // Extract search terms for keyword search
  // Use all significant terms (3+ chars) from topic
  const searchTerms = topic
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !['the', 'and', 'for', 'with'].includes(w.toLowerCase()))

  // Build OR filter for keyword search
  const keywordFilter = searchTerms.map((term) => `patent_title.ilike.%${term}%`).join(',')

  const [keywordResult, linkedResult] = await Promise.all([
    // Keyword search on patent titles - match any term
    supabaseAdmin
      .from('patents')
      .select('patent_id, patent_title, patent_org, issue_date, filing_date, project_number, abstract')
      .or(keywordFilter)
      .order('issue_date', { ascending: false, nullsFirst: false })
      .limit(30),

    // Project-linked approach: find projects, get their linked patents
    (async () => {
      const { data: projects } = await supabaseAdmin.rpc('search_projects_filtered', {
        query_embedding: queryEmbedding,
        match_threshold: UNIFIED_THRESHOLD,
        match_count: 30,
        min_biotools_confidence: 0,
        filter_fiscal_years: null,
        filter_categories: null,
        filter_org_types: null,
        filter_states: null,
        filter_min_funding: null,
        filter_max_funding: null,
      })

      if (!projects || projects.length === 0) {
        return { data: null, error: null }
      }

      const projectNumbers = projects
        .map((p: { project_number: string }) => p.project_number)
        .filter(Boolean)

      if (projectNumbers.length === 0) {
        return { data: null, error: null }
      }

      // Get patents linked to these projects
      return supabaseAdmin
        .from('patents')
        .select('patent_id, patent_title, patent_org, issue_date, filing_date, project_number, abstract')
        .in('project_number', projectNumbers)
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(30)
    })(),
  ])

  // Merge results, prioritizing linked matches (from semantically relevant projects)
  const seenPatents = new Map<string, RawPatentResult>()

  // Add linked patents first (more specific to topic via project linkage)
  if (linkedResult.data) {
    for (const patent of linkedResult.data) {
      if (!seenPatents.has(patent.patent_id)) {
        seenPatents.set(patent.patent_id, patent)
      }
    }
  }

  // Add keyword results that weren't already included
  if (keywordResult.data) {
    for (const patent of keywordResult.data) {
      if (!seenPatents.has(patent.patent_id)) {
        seenPatents.set(patent.patent_id, patent)
      }
    }
  }

  const mergedResults = Array.from(seenPatents.values())

  console.log(
    `[Patents Agent] Found ${mergedResults.length} patents ` +
      `(${keywordResult.data?.length || 0} keyword, ${linkedResult.data?.length || 0} linked)`
  )

  if (mergedResults.length === 0) {
    return emptyOutput()
  }

  const limitedResults = mergedResults.slice(0, 30)

  // Check for missing abstracts and enrich from Google Patents (limit to 15 due to scraping)
  const needsEnrichment = limitedResults.filter((p) => !p.abstract).slice(0, 15)
  if (needsEnrichment.length > 0) {
    console.log(`[Patents Agent] ${needsEnrichment.length} patents need abstract enrichment`)
    const enriched = await enrichPatentAbstracts(needsEnrichment.map((p) => p.patent_id))

    // Update results with fetched abstracts
    for (const patent of limitedResults) {
      if (!patent.abstract && enriched[patent.patent_id]) {
        patent.abstract = enriched[patent.patent_id]
      }
    }
  }

  return processResults(limitedResults)
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawPatentResult[]): PatentsAgentOutput {
  // Map to PatentItem format
  const items: PatentItem[] = rawResults.map((p) => ({
    patent_id: p.patent_id,
    patent_title: p.patent_title || null,
    patent_abstract: p.abstract || null,
    assignee: p.patent_org || null,
    patent_date: p.issue_date || p.filing_date || null,
    inventors: null, // Not available in current schema
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

  console.log(`[Patents Agent] Processed ${items.length} patents (${recentCount} recent)`)
  console.log(`  - Top assignees:`, byAssignee.slice(0, 3).map(a => a.assignee).join(', ') || 'None')

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

/**
 * Scrape patent abstracts from Google Patents and save to database
 * Returns map of patent_id -> abstract for immediate use
 */
async function enrichPatentAbstracts(patentIds: string[]): Promise<Record<string, string>> {
  console.log(`[Patents Agent] Scraping ${patentIds.length} abstracts from Google Patents`)

  const abstracts: Record<string, string> = {}

  // Process patents in batches with rate limiting
  const batchSize = 3
  for (let i = 0; i < patentIds.length; i += batchSize) {
    const batch = patentIds.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async (patentId) => {
        try {
          // Google Patents URL format
          const url = `https://patents.google.com/patent/US${patentId}`

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; GrantedBio/1.0)',
            },
          })

          if (!response.ok) {
            console.warn(`[Patents Agent] Failed to fetch patent ${patentId}: ${response.status}`)
            return
          }

          const html = await response.text()

          // Extract abstract from HTML
          // Google Patents has abstract in <meta name="description"> or <div class="abstract">
          let abstract: string | null = null

          // Try meta description first
          const metaMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
          if (metaMatch) {
            abstract = metaMatch[1].trim()
          }

          // Try abstract div
          if (!abstract) {
            const abstractMatch = html.match(/<div\s+class="abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
            if (abstractMatch) {
              // Strip HTML tags
              abstract = abstractMatch[1].replace(/<[^>]+>/g, '').trim()
            }
          }

          if (abstract && abstract.length > 50) {
            abstracts[patentId] = abstract

            // Save to database
            try {
              await supabaseAdmin.from('patents').update({ abstract }).eq('patent_id', patentId)
            } catch (dbError) {
              console.warn(`[Patents Agent] Error saving abstract for patent ${patentId}:`, dbError)
            }
          }
        } catch (error) {
          console.warn(`[Patents Agent] Error scraping patent ${patentId}:`, error)
        }
      })
    )

    // Rate limiting between batches
    if (i + batchSize < patentIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.log(`[Patents Agent] Scraped ${Object.keys(abstracts).length} abstracts`)
  return abstracts
}

// Type for raw database results
interface RawPatentResult {
  patent_id: string
  patent_title?: string | null
  patent_org?: string | null
  issue_date?: string | null
  filing_date?: string | null
  project_number?: string | null
  abstract?: string | null
}
