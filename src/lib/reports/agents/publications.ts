// Publications Agent
// Fetches publications linked to specific projects
// Projects are pre-filtered for relevance, so linked publications are inherently relevant
// Enriches abstracts from PubMed if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { PublicationsAgentOutput, PublicationItem } from '../types'
import { expandProjectNumberVariants } from '@/lib/project-number-utils'

/**
 * Run the Publications Agent to gather publication data linked to specific projects
 * Projects are pre-filtered for topic relevance, so linked publications are inherently relevant
 *
 * @param projectNumbers - NIH project numbers to fetch publications for (already filtered for relevance)
 */
export async function runPublicationsAgent(projectNumbers: string[]): Promise<PublicationsAgentOutput> {
  console.log(`[Publications Agent] Fetching publications for ${projectNumbers.length} projects`)

  if (projectNumbers.length === 0) {
    return emptyOutput()
  }

  // Get PMIDs from linking table for these specific projects.
  // expandProjectNumberVariants is defensive: today's callers
  // (projectsOutput.allProjectNumbers) already include both forms,
  // but the agent should be robust to any caller passing a single
  // form. The linkage table stores core only, so without expansion
  // a full-form-only list would silently miss matches.
  const { data: links, error: linkError } = await supabaseAdmin
    .from('project_publications')
    .select('pmid')
    .in('project_number', expandProjectNumberVariants(projectNumbers))

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

  // Fetch full publication details. pub_year is selected alongside pub_date
  // because PubMed esummary's pubdate format is inconsistent ("2024 Spring",
  // "Mar-Apr", etc.) and our date parser falls back to NULL on those —
  // but the year-extracted regex in pub_year still succeeds. Without
  // pub_year the renderer would show "Year: N/A" on otherwise-complete
  // records.
  const { data: publications, error: pubError } = await supabaseAdmin
    .from('publications')
    .select('pmid, pub_title, journal_title, pub_date, pub_year, author_list, abstract')
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
    pub_year: pub.pub_year,
    authors: pub.author_list,
    abstract: pub.abstract,
  }))

  console.log(`[Publications Agent] Found ${results.length} publications`)

  // Check for missing abstracts and enrich from PubMed (up to 30)
  const needsEnrichment = results.filter((p) => !p.abstract).slice(0, 30)
  if (needsEnrichment.length > 0) {
    console.log(`[Publications Agent] ${needsEnrichment.length} publications need abstract enrichment`)
    const enriched = await enrichPublicationAbstracts(needsEnrichment.map((p) => p.pmid))

    // Update results with fetched abstracts
    for (const pub of results) {
      if (!pub.abstract && enriched[pub.pmid]) {
        pub.abstract = enriched[pub.pmid]
      }
    }
  }

  return processResults(results)
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
    pub_year: p.pub_year ?? null,
    authors: p.authors || null,
    abstract: p.abstract || null,
  }))

  // Group by journal
  const journalMap = new Map<string, number>()
  items.forEach((p) => {
    if (!p.journal) return
    journalMap.set(p.journal, (journalMap.get(p.journal) || 0) + 1)
  })
  const totalUniqueJournals = journalMap.size
  const byJournal = Array.from(journalMap.entries())
    .map(([journal, count]) => ({ journal, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Group by year. Prefer pub_year (always cleanly populated by the
  // PubMed metadata fetcher) and fall back to deriving from publication_date
  // — keeps rows in the histogram where publication_date is NULL but
  // pub_year is set.
  const yearMap = new Map<number, number>()
  items.forEach((p) => {
    let year: number | null = p.pub_year ?? null
    if (year === null && p.publication_date) {
      const derived = new Date(p.publication_date).getFullYear()
      if (!isNaN(derived)) year = derived
    }
    if (year === null) return
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
    totalUniqueJournals,
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
    totalUniqueJournals: 0,
  }
}

// Type for raw database results
interface RawPublicationResult {
  pmid: string
  publication_title?: string | null
  journal?: string | null
  publication_date?: string | null
  pub_year?: number | null
  authors?: string | null
  abstract?: string | null
}
