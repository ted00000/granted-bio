// Publications Agent
// Fetches publications linked to specific projects
// Filters for topic relevance to ensure publications are actually related to the report topic
// Enriches abstracts from PubMed if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { PublicationsAgentOutput, PublicationItem } from '../types'
import { filterForRelevance, quickRelevanceCheck } from '../relevance-filter'

/**
 * Run the Publications Agent to gather publication data linked to specific projects
 * Filters publications for topic relevance to ensure they're actually related to the report topic
 *
 * @param projectNumbers - NIH project numbers to fetch publications for
 * @param topic - The report topic for relevance filtering (e.g., "monoclonal antibody production")
 */
export async function runPublicationsAgent(projectNumbers: string[], topic: string): Promise<PublicationsAgentOutput> {
  console.log(`[Publications Agent] Fetching publications for ${projectNumbers.length} projects (topic: ${topic})`)

  if (projectNumbers.length === 0) {
    return emptyOutput()
  }

  // Get PMIDs from linking table for these specific projects
  const { data: links, error: linkError } = await supabaseAdmin
    .from('project_publications')
    .select('pmid')
    .in('project_number', projectNumbers)

  if (linkError) {
    console.error('[Publications Agent] Error fetching publication links:', linkError)
    return emptyOutput()
  }

  if (!links || links.length === 0) {
    console.log('[Publications Agent] No publications found for these projects')
    return emptyOutput()
  }

  // Deduplicate PMIDs (a publication may be linked to multiple projects)
  const uniquePmids = [...new Set(links.map((l) => l.pmid))]
  console.log(`[Publications Agent] Found ${uniquePmids.length} unique PMIDs (from ${links.length} linked)`)

  // Fetch full publication details
  const { data: publications, error: pubError } = await supabaseAdmin
    .from('publications')
    .select('pmid, pub_title, journal_title, pub_date, author_list, abstract')
    .in('pmid', uniquePmids)
    .order('pub_date', { ascending: false })

  if (pubError) {
    console.error('[Publications Agent] Error fetching publications:', pubError)
    return emptyOutput()
  }

  if (!publications || publications.length === 0) {
    console.log('[Publications Agent] No publication details found')
    return emptyOutput()
  }

  // Map to internal format
  const results: RawPublicationResult[] = publications.map((pub) => ({
    pmid: pub.pmid,
    publication_title: pub.pub_title,
    journal: pub.journal_title,
    publication_date: pub.pub_date,
    authors: pub.author_list,
    abstract: pub.abstract,
  }))

  // Filter for topic relevance
  // First, quick filter to reduce items before AI filtering
  const quickFiltered = results.filter((p) =>
    quickRelevanceCheck(topic, p.publication_title || '', p.abstract)
  )
  console.log(`[Publications Agent] Quick filter: ${quickFiltered.length}/${results.length} passed`)

  // Then AI-based filtering for remaining items
  let relevantPubs = quickFiltered
  if (quickFiltered.length > 0) {
    const filterItems = quickFiltered.map((p) => ({
      id: p.pmid,
      title: p.publication_title || 'Untitled Publication',
      description: p.abstract,
    }))
    const filterResult = await filterForRelevance(topic, filterItems, 'publications')
    const relevantIds = new Set(filterResult.kept)
    relevantPubs = quickFiltered.filter((p) => relevantIds.has(p.pmid))
  }
  console.log(`[Publications Agent] After relevance filter: ${relevantPubs.length} publications`)

  if (relevantPubs.length === 0) {
    console.log('[Publications Agent] No relevant publications after filtering')
    return emptyOutput()
  }

  // Check for missing abstracts and enrich from PubMed (up to 30)
  const needsEnrichment = relevantPubs.filter((p) => !p.abstract).slice(0, 30)
  if (needsEnrichment.length > 0) {
    console.log(`[Publications Agent] ${needsEnrichment.length} publications need abstract enrichment`)
    const enriched = await enrichPublicationAbstracts(needsEnrichment.map((p) => p.pmid))

    // Update results with fetched abstracts
    for (const pub of relevantPubs) {
      if (!pub.abstract && enriched[pub.pmid]) {
        pub.abstract = enriched[pub.pmid]
      }
    }
  }

  return processResults(relevantPubs)
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawPublicationResult[]): PublicationsAgentOutput {
  // Map to PublicationItem format
  const items: PublicationItem[] = rawResults.map((p) => ({
    pmid: p.pmid,
    publication_title: p.publication_title || null,
    journal: p.journal || null,
    publication_date: p.publication_date || null,
    authors: p.authors || null,
    abstract: p.abstract || null,
  }))

  // Group by journal
  const journalMap = new Map<string, number>()
  items.forEach((p) => {
    if (!p.journal) return
    journalMap.set(p.journal, (journalMap.get(p.journal) || 0) + 1)
  })
  const byJournal = Array.from(journalMap.entries())
    .map(([journal, count]) => ({ journal, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Group by year
  const yearMap = new Map<number, number>()
  items.forEach((p) => {
    if (!p.publication_date) return
    const year = new Date(p.publication_date).getFullYear()
    if (isNaN(year)) return
    yearMap.set(year, (yearMap.get(year) || 0) + 1)
  })
  const byYear = Array.from(yearMap.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year)

  console.log(`[Publications Agent] Processed ${items.length} publications`)

  return {
    items,
    byJournal,
    byYear,
  }
}

/**
 * Fetch abstracts from PubMed API and save to database
 * Returns map of pmid -> abstract for immediate use
 */
async function enrichPublicationAbstracts(pmids: string[]): Promise<Record<string, string>> {
  console.log(`[Publications Agent] Fetching ${pmids.length} abstracts from PubMed`)

  const abstracts: Record<string, string> = {}

  // PubMed E-utilities efetch API
  // https://www.ncbi.nlm.nih.gov/books/NBK25499/
  const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&rettype=abstract&retmode=xml`

  try {
    const response = await fetch(efetchUrl)
    if (!response.ok) {
      console.warn(`[Publications Agent] PubMed fetch failed: ${response.status}`)
      return abstracts
    }

    const xml = await response.text()

    // Parse each article's abstract
    // PubMed XML structure: <PubmedArticle>...<Abstract><AbstractText>...</AbstractText></Abstract>...</PubmedArticle>
    const articleMatches = xml.matchAll(/<PubmedArticle[\s\S]*?<\/PubmedArticle>/g)

    for (const match of articleMatches) {
      const articleXml = match[0]

      // Extract PMID
      const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/)
      if (!pmidMatch) continue
      const pmid = pmidMatch[1]

      // Extract abstract text (may have multiple AbstractText elements)
      const abstractTexts: string[] = []
      const abstractMatches = articleXml.matchAll(/<AbstractText[^>]*>([^<]+)<\/AbstractText>/g)
      for (const absMatch of abstractMatches) {
        abstractTexts.push(absMatch[1])
      }

      if (abstractTexts.length > 0) {
        const abstract = abstractTexts.join(' ')
        abstracts[pmid] = abstract

        // Save to database
        try {
          await supabaseAdmin
            .from('publications')
            .update({ abstract })
            .eq('pmid', pmid)
        } catch (dbError) {
          console.warn(`[Publications Agent] Error saving abstract for PMID ${pmid}:`, dbError)
        }
      }
    }

    console.log(`[Publications Agent] Fetched ${Object.keys(abstracts).length} abstracts`)
  } catch (error) {
    console.warn('[Publications Agent] PubMed enrichment failed:', error)
  }

  return abstracts
}

/**
 * Return empty output
 */
function emptyOutput(): PublicationsAgentOutput {
  return {
    items: [],
    byJournal: [],
    byYear: [],
  }
}

// Type for raw database results
interface RawPublicationResult {
  pmid: string
  publication_title?: string | null
  journal?: string | null
  publication_date?: string | null
  authors?: string | null
  abstract?: string | null
}
