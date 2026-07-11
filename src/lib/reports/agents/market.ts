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
- **DATE PREFIX INTEGRITY.** The YYYY-MM prefix MUST match the actual event date described in the entry. If the entry describes an event at ASCO 2026 in May, the prefix is 2026-05, not 2025-05. Before returning a recentDevelopments item, verify the year/month in the prefix matches the year/month in the description text. A mismatched prefix (e.g. "2025-05: filed at ASCO 2026") reads as an error and destroys credibility. Today is ${today} — no valid entry can be prefixed with a date later than today.
- **TWO-POINT TREND HEDGE.** If your overview or competitiveLandscape mentions two consecutive years of NIH funding side-by-side (e.g. "FY2024 $38.9M and FY2025 $49.6M"), you MUST append the hedge "though two data points do not establish a trend" (or equivalent) in the same sentence. Do NOT write "suggesting sustained and expanding public commitment", "signals growth", "reflects momentum" - those are trend claims and 2 data points can't support them. This rule holds for every field in this response, not just the numbers-dominant paragraphs.
- If search returned no useful information for a field, use null or [].
- FORMATTING: Do NOT use em dashes. Use regular hyphens.
- **BANNED FIELD-LEVEL "CLEAR GAP" ABSOLUTES.** Do not write "clear methodological gap", "clear point-of-care gap", "clear [any] gap", "a clear gap exists", "structural underfunding". Rewrite as observation-in-sample: "within the analyzed sample, X is thinly represented."
- **BANNED "structural" MODIFIER APPLIED TO THE FIELD.** Do not write "structural competitive risks", "structural risk to the field", "structural shift", "structural change", or any "structural [noun]" attached to a field-level claim. "Structural" implies a permanent, systemic property that a market-context report can't support from current news items. Rewrite as "competitive risks that could reshape the field" (drop "structural") or "market dynamics worth monitoring" (softer). Applies to overview, competitiveLandscape, and marketSize fields alike.

CLINICAL-RESULT HONESTY (critical — do not skip):
When you mention a specific clinical trial or product's Phase results, cite BOTH positive AND negative findings if the search surfaces them. A domain expert catches a report that mentions the positives of Trial A without acknowledging Trial B (same product, different study) that missed its primary endpoint. Examples of the specific type of framing to use:
- If a search reveals both positive and negative Phase 3 readouts for a product, write "Product X's PATHFINDER 2 trial reported positive results while its parallel NHS-Galleri UK RCT missed its primary endpoint" — NOT "positive Phase 3 trial results" as if there were only one.
- If a submission was filed after mixed results, say "filed after mixed Phase 3 readouts" not "after positive Phase 3."
- Do NOT infer that a submission "based on positive results" means all Phase 3 studies were positive — search for negative readouts before writing single-sided framing.
Explicitly search for any high-profile trial failures, primary-endpoint misses, or negative readouts for the major companies you cite. If you find one and don't mention it, a reviewer catches the omission and it costs credibility.

**NAMED-PRODUCT SYMMETRY.** The same both-sides rule applies to EVERY named clinical product in this space, not only the products with famous misses. If you cite by name any MCED test or liquid-biopsy product (DELFI Diagnostics, GRAIL Galleri, Guardant Shield, Freenome, Exact/Cologuard, Natera Signatera, MRDetect, ArcherDX, Foundation Medicine, Adaptive Biotech, etc), you MUST either:
  (a) cite both the positive readouts AND any known concerns (specificity/PPV challenges, screening-population caveats, PMA delays, coverage denials, real-world PPV underperformance vs trial PPV) — the audit reader knows the landscape;
  OR
  (b) restrict the mention to a factual description of what the product does, without citing any efficacy or readout claim.
Do NOT cite a named product's positive result without at least acknowledging that the corresponding real-world / screening-population evidence is still developing. Single-sided named-product framing is the same failure mode as single-sided GRAIL PATHFINDER 2 - just at a lower-visibility product.

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

  // Deterministic date-prefix reconciliation. r29 audit surfaced
  // "2026-03: GRAIL presented at ASCO 2026 (June 1, 2026)" — the LLM's
  // YYYY-MM prefix contradicted the event date in its own text. Prompt
  // rule alone doesn't hold. Scan each development for an inline
  // date/month token that unambiguously specifies a different YYYY-MM,
  // and if found, rewrite the prefix to match.
  const reconciledDevelopments = Array.isArray(parsed.recentDevelopments)
    ? parsed.recentDevelopments.map((entry: unknown) => reconcileDatePrefix(String(entry)))
    : []
  // Dedupe near-duplicate developments. r31 audit surfaced the Guardant-
  // Quest Shield CRC collaboration appearing at both 2025-09 and 2026-03
  // with almost identical phrasing. Web search returns multiple articles
  // on the same event across months, and the LLM sometimes emits both
  // as separate bullets. Fuzzy-match on the significant word set
  // (excluding stopwords + the date prefix) and drop the later dup.
  const dedupedDevelopments = dedupeDevelopments(reconciledDevelopments)

  return {
    overview: parsed.overview || '',
    marketSize: parsed.marketSize || null,
    keyPlayers: Array.isArray(parsed.keyPlayers) ? parsed.keyPlayers : [],
    recentDevelopments: dedupedDevelopments,
    competitiveLandscape: parsed.competitiveLandscape || '',
    sources: uniqueSources,
  }
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'this',
  'that', 'these', 'those', 'over', 'under', 'up', 'down',
])

/**
 * Fuzzy-dedupe near-duplicate development entries. Two entries are
 * "duplicates" when the Jaccard similarity of their meaningful word
 * sets (lowercased, stopwords + date-prefix removed) is >= 0.5. Keeps
 * the FIRST occurrence.
 */
function dedupeDevelopments(entries: string[]): string[] {
  const kept: Array<{ entry: string; sig: Set<string> }> = []
  for (const entry of entries) {
    // Strip YYYY-MM prefix.
    const body = entry.replace(/^\d{4}-\d{2}\s*:\s*/, '')
    // Extract meaningful tokens (alphabetic 4+ chars, not stopwords).
    const sig = new Set(
      (body.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOPWORDS.has(w)),
    )
    if (sig.size === 0) {
      kept.push({ entry, sig })
      continue
    }
    let isDupe = false
    for (const prior of kept) {
      if (prior.sig.size === 0) continue
      // Jaccard similarity: |A intersect B| / |A union B|.
      let intersect = 0
      for (const w of sig) if (prior.sig.has(w)) intersect++
      const union = sig.size + prior.sig.size - intersect
      const jaccard = union > 0 ? intersect / union : 0
      if (jaccard >= 0.5) {
        console.warn(
          `[Market Agent] Dropped duplicate development (Jaccard ${jaccard.toFixed(2)}): "${entry.slice(0, 100)}"`,
        )
        isDupe = true
        break
      }
    }
    if (!isDupe) kept.push({ entry, sig })
  }
  return kept.map((k) => k.entry)
}

const MONTH_MAP: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
}

/**
 * When an entry's YYYY-MM prefix contradicts a date reference in the
 * body ("2025-05: filed at ASCO 2026 (May 2026)"), rewrite the prefix
 * to match the body. Only fires when the body contains a clear
 * MonthName + YYYY pair that unambiguously specifies a different
 * YYYY-MM than the prefix — otherwise leaves the entry untouched.
 */
function reconcileDatePrefix(entry: string): string {
  const prefixMatch = entry.match(/^(\d{4})-(\d{2})\s*:\s*([\s\S]*)$/)
  if (!prefixMatch) return entry
  const [, prefixYear, prefixMonth, rest] = prefixMatch
  // Look for "MonthName YYYY" (e.g. "May 2026" or "June 1, 2026").
  const bodyMatch = rest.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:\d{1,2}(?:,)?\s+)?(\d{4})\b/i,
  )
  if (!bodyMatch) return entry
  const bodyMonth = MONTH_MAP[bodyMatch[1].toLowerCase()]
  const bodyYear = bodyMatch[2]
  if (bodyMonth === prefixMonth && bodyYear === prefixYear) return entry
  console.warn(
    `[Market Agent] Reconciling date prefix ${prefixYear}-${prefixMonth} -> ${bodyYear}-${bodyMonth} based on body reference "${bodyMatch[0]}"`,
  )
  return `${bodyYear}-${bodyMonth}: ${rest}`
}
