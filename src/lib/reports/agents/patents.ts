// Patents Agent
// Fetches patents linked to specific projects
// Enriches abstracts from Google Patents if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { PatentsAgentOutput, PatentItem } from '../types'

/**
 * Run the Patents Agent to gather patent data linked to specific projects
 * Only returns patents that are directly linked to the provided project numbers
 */
export async function runPatentsAgent(projectNumbers: string[]): Promise<PatentsAgentOutput> {
  console.log(`[Patents Agent] Fetching patents for ${projectNumbers.length} projects`)

  if (projectNumbers.length === 0) {
    return emptyOutput()
  }

  // Get patent IDs from junction table for these specific projects
  const { data: links, error: linkError } = await supabaseAdmin
    .from('project_patents')
    .select('patent_id')
    .in('project_number', projectNumbers)

  if (linkError) {
    console.error('[Patents Agent] Error fetching patent links:', linkError)
    return emptyOutput()
  }

  if (!links || links.length === 0) {
    console.log('[Patents Agent] No patents found for these projects')
    return emptyOutput()
  }

  // Deduplicate patent IDs (a patent may be linked to multiple projects)
  const uniquePatentIds = [...new Set(links.map((l) => l.patent_id))]
  console.log(`[Patents Agent] Found ${uniquePatentIds.length} unique patent IDs (from ${links.length} linked)`)

  // Fetch full patent details
  const { data: linkedPatents, error } = await supabaseAdmin
    .from('patents')
    .select('patent_id, patent_title, patent_org, issue_date, filing_date, abstract')
    .in('patent_id', uniquePatentIds)
    .order('issue_date', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('[Patents Agent] Error fetching patents:', error)
    return emptyOutput()
  }

  if (!linkedPatents || linkedPatents.length === 0) {
    console.log('[Patents Agent] No patents found for these projects')
    return emptyOutput()
  }

  // Deduplicate by patent_id (a patent may be linked to multiple projects)
  const seenPatents = new Map<string, RawPatentResult>()
  for (const patent of linkedPatents) {
    if (!seenPatents.has(patent.patent_id)) {
      seenPatents.set(patent.patent_id, patent)
    }
  }

  const uniquePatents = Array.from(seenPatents.values())
  console.log(`[Patents Agent] Found ${uniquePatents.length} unique patents (from ${linkedPatents.length} linked)`)

  // Check for missing abstracts and enrich from Google Patents (limit to 15 due to scraping)
  const needsEnrichment = uniquePatents.filter((p) => !p.abstract).slice(0, 15)
  if (needsEnrichment.length > 0) {
    console.log(`[Patents Agent] ${needsEnrichment.length} patents need abstract enrichment`)
    const enriched = await enrichPatentAbstracts(needsEnrichment.map((p) => p.patent_id))

    // Update results with fetched abstracts
    for (const patent of uniquePatents) {
      if (!patent.abstract && enriched[patent.patent_id]) {
        patent.abstract = enriched[patent.patent_id]
      }
    }
  }

  return processResults(uniquePatents)
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
  abstract?: string | null
}
