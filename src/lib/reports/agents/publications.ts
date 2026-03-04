// Publications Agent
// Searches publications linked to NIH projects
// Enriches data from PubMed if needed

import { supabaseAdmin } from '@/lib/supabase'
import type { PublicationsAgentOutput, PublicationItem } from '../types'

/**
 * Run the Publications Agent to gather publication data for a topic
 */
export async function runPublicationsAgent(topic: string): Promise<PublicationsAgentOutput> {
  console.log(`[Publications Agent] Searching for "${topic}"`)

  // First, find relevant projects for the topic
  const queryEmbedding = await generateEmbedding(topic)

  const { data: projects } = await supabaseAdmin.rpc('search_projects_filtered', {
    query_embedding: queryEmbedding,
    match_threshold: 0.25,
    match_count: 50,
    min_biotools_confidence: 0,
    filter_fiscal_years: null,
    filter_categories: null,
    filter_org_types: null,
    filter_states: null,
    filter_min_funding: null,
    filter_max_funding: null,
  })

  if (!projects || projects.length === 0) {
    console.log('[Publications Agent] No projects found')
    return emptyOutput()
  }

  // Get project numbers to find linked publications
  const projectNumbers = projects
    .map((p: { project_number: string }) => p.project_number)
    .filter(Boolean)

  if (projectNumbers.length === 0) {
    console.log('[Publications Agent] No project numbers found')
    return emptyOutput()
  }

  // Fetch publications linked to these projects
  const { data: publications, error } = await supabaseAdmin
    .from('project_publications')
    .select('pmid, publication_title, journal, publication_date, authors, abstract')
    .in('project_number', projectNumbers)
    .order('publication_date', { ascending: false })
    .limit(30)

  if (error) {
    console.error('[Publications Agent] Query error:', error)
    return emptyOutput()
  }

  // Check for publications that need enrichment
  const needsEnrichment = (publications || []).filter(
    (p) => !p.journal || !p.authors
  )

  if (needsEnrichment.length > 0 && needsEnrichment.length <= 10) {
    console.log(`[Publications Agent] ${needsEnrichment.length} publications need enrichment`)
    await enrichPublications(needsEnrichment.map((p) => p.pmid))

    // Refetch with enriched data
    const { data: refreshed } = await supabaseAdmin
      .from('project_publications')
      .select('pmid, publication_title, journal, publication_date, authors, abstract')
      .in('project_number', projectNumbers)
      .order('publication_date', { ascending: false })
      .limit(30)

    return processResults(refreshed || [])
  }

  return processResults(publications || [])
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
 * Enrich publications by fetching from PubMed API
 */
async function enrichPublications(pmids: string[]): Promise<void> {
  console.log(`[Publications Agent] Enriching ${pmids.length} publications from PubMed`)

  // PubMed E-utilities API
  // https://www.ncbi.nlm.nih.gov/books/NBK25499/
  const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml`

  try {
    const response = await fetch(efetchUrl)
    if (!response.ok) {
      console.warn(`[Publications Agent] PubMed fetch failed: ${response.status}`)
      return
    }

    const xml = await response.text()

    // Parse XML and extract data (basic parsing)
    // For production, use a proper XML parser
    for (const pmid of pmids) {
      try {
        // Extract journal title
        const journalMatch = xml.match(
          new RegExp(`<PMID[^>]*>${pmid}</PMID>[\\s\\S]*?<Title>([^<]+)</Title>`)
        )
        const journal = journalMatch?.[1] || null

        // Extract authors (first author)
        const authorsMatch = xml.match(
          new RegExp(
            `<PMID[^>]*>${pmid}</PMID>[\\s\\S]*?<AuthorList[^>]*>([\\s\\S]*?)</AuthorList>`
          )
        )
        let authors = null
        if (authorsMatch) {
          const lastNameMatch = authorsMatch[1].match(/<LastName>([^<]+)<\/LastName>/)
          const initialsMatch = authorsMatch[1].match(/<Initials>([^<]+)<\/Initials>/)
          if (lastNameMatch) {
            authors = `${lastNameMatch[1]} ${initialsMatch?.[1] || ''} et al.`
          }
        }

        // Update database
        if (journal || authors) {
          await supabaseAdmin
            .from('project_publications')
            .update({
              journal: journal || undefined,
              authors: authors || undefined,
            })
            .eq('pmid', pmid)
        }
      } catch (parseError) {
        console.warn(`[Publications Agent] Error parsing PMID ${pmid}:`, parseError)
      }
    }
  } catch (error) {
    console.warn('[Publications Agent] PubMed enrichment failed:', error)
  }
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
