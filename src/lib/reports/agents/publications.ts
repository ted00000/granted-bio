// Publications Agent
// Searches publications linked to NIH projects
// Uses hybrid approach: keyword search + project-linked search

import { supabaseAdmin } from '@/lib/supabase'
import type { PublicationsAgentOutput, PublicationItem } from '../types'

const UNIFIED_THRESHOLD = 0.35

/**
 * Run the Publications Agent to gather publication data for a topic
 * Uses hybrid approach: keyword search + project-linked search
 */
export async function runPublicationsAgent(topic: string): Promise<PublicationsAgentOutput> {
  console.log(`[Publications Agent] Searching for "${topic}"`)

  const queryEmbedding = await generateEmbedding(topic)

  // Try two approaches in parallel:
  // 1. Direct semantic search on publications table
  // 2. Project-linked search via project_publications

  // Extract keywords for fallback search - use most specific terms
  const queryWords = topic
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !['cell', 'cells', 'therapy', 'treatment'].includes(w)) // Remove generic terms

  // Build a more specific search - require primary term
  const primaryTerm = topic.split(/\s+/)[0] // e.g., "CAR-T" or "CRISPR"

  const [keywordResult, linkedResult] = await Promise.all([
    // Keyword search on publications table - use primary term for specificity
    supabaseAdmin
      .from('publications')
      .select('pmid, pub_title, journal_title, pub_date, author_list, abstract')
      .ilike('pub_title', `%${primaryTerm}%`)
      .order('pub_date', { ascending: false })
      .limit(30),

    // Project-linked approach: get PMIDs then fetch publication details
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

      // Get PMIDs from linking table
      const { data: links } = await supabaseAdmin
        .from('project_publications')
        .select('pmid')
        .in('project_number', projectNumbers)
        .limit(50)

      if (!links || links.length === 0) {
        return { data: null, error: null }
      }

      const pmids = links.map((l) => l.pmid)

      // Fetch full publication details
      return supabaseAdmin
        .from('publications')
        .select('pmid, pub_title, journal_title, pub_date, author_list, abstract')
        .in('pmid', pmids)
        .order('pub_date', { ascending: false })
        .limit(30)
    })(),
  ])

  // Merge results, prioritizing keyword matches (more specific) over linked
  const seenPmids = new Set<string>()
  const mergedResults: RawPublicationResult[] = []

  // Add keyword search results first (most specific/relevant)
  if (keywordResult.data) {
    for (const pub of keywordResult.data) {
      if (!seenPmids.has(pub.pmid)) {
        seenPmids.add(pub.pmid)
        mergedResults.push({
          pmid: pub.pmid,
          publication_title: pub.pub_title,
          journal: pub.journal_title,
          publication_date: pub.pub_date,
          authors: pub.author_list,
          abstract: pub.abstract,
        })
      }
    }
  }

  // Add linked publications that weren't already included
  if (linkedResult.data) {
    for (const pub of linkedResult.data) {
      if (!seenPmids.has(pub.pmid)) {
        seenPmids.add(pub.pmid)
        mergedResults.push({
          pmid: pub.pmid,
          publication_title: pub.pub_title,
          journal: pub.journal_title,
          publication_date: pub.pub_date,
          authors: pub.author_list,
          abstract: pub.abstract,
        })
      }
    }
  }

  console.log(
    `[Publications Agent] Found ${mergedResults.length} publications ` +
      `(${linkedResult.data?.length || 0} linked, ${keywordResult.data?.length || 0} keyword)`
  )

  if (mergedResults.length === 0) {
    return emptyOutput()
  }

  // Limit to 30 results
  const limitedResults = mergedResults.slice(0, 30)

  // Check for missing abstracts and enrich from PubMed (up to 30)
  const needsEnrichment = limitedResults.filter((p) => !p.abstract)
  if (needsEnrichment.length > 0) {
    console.log(`[Publications Agent] ${needsEnrichment.length} publications need abstract enrichment`)
    const enriched = await enrichPublicationAbstracts(needsEnrichment.map((p) => p.pmid))

    // Update results with fetched abstracts
    for (const pub of limitedResults) {
      if (!pub.abstract && enriched[pub.pmid]) {
        pub.abstract = enriched[pub.pmid]
      }
    }
  }

  return processResults(limitedResults)
}

/**
 * Process raw results into agent output
 */
function processResults(rawResults: RawPublicationResult[]): PublicationsAgentOutput {
  // Dedupe by PMID
  const seen = new Set<string>()
  const deduped = rawResults.filter((p) => {
    if (seen.has(p.pmid)) return false
    seen.add(p.pmid)
    return true
  })

  // Map to PublicationItem format
  const items: PublicationItem[] = deduped.map((p) => ({
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

  console.log(`[Publications Agent] Found ${items.length} publications`)

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
interface RawPublicationResult {
  pmid: string
  publication_title?: string | null
  journal?: string | null
  publication_date?: string | null
  authors?: string | null
  abstract?: string | null
}
