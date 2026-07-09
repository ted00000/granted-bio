/**
 * "What Surprised Us" — algorithmic detection of non-obvious findings.
 *
 * Motivation: a strong intelligence report doesn't just describe what's
 * there — it flags what's UNEXPECTED. Reviewers of prior reports called
 * out that most conclusions felt like "logical extrapolations" rather
 * than surprises. To fix that without asking the LLM to freeform-guess
 * (which produces contrived surprises), we detect anomalies from the
 * structured data FIRST, then ask the LLM only to narrate why each
 * detected anomaly matters.
 *
 * Detectors implemented (each is a candidate anomaly type):
 *
 *   1. Translation-gap orgs: org has substantial NIH funding but zero
 *      linked patents AND zero linked trials — foundational research
 *      that hasn't produced downstream IP or clinical development.
 *   2. Isolated top-funded PI: a PI with a single very large grant
 *      (single-project bet, no follow-on, no linked outputs).
 *   3. Publication-heavy but clinically thin: the field has substantial
 *      publication volume but few or no clinical trials — pattern of
 *      unrealized translational potential.
 *   4. Big broader-NIH gap: a white-space category where broader NIH
 *      activity vastly exceeds the topic slice — a whole adjacent
 *      research community is doing this and the topic is missing it.
 *   5. Recency mismatch: portfolio funding leans very recent OR very
 *      old, indicating a hot new field or a maturing one that has
 *      cooled.
 *
 * Each detector emits candidates with a strength score. The top N by
 * score go to the LLM for narration.
 */

import Anthropic from '@anthropic-ai/sdk'
import { normalizeOrgName, normalizePIName } from '@/lib/format-names'
import type {
  AllAgentOutputs,
  FundingStats,
  OrgStats,
  ResearcherStats,
  WhiteSpaceAnalysis,
} from './types'

const MODEL = 'claude-sonnet-4-6'

interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

export interface SurprisingFinding {
  /** Short 1-line hook naming what was surprising. */
  headline: string
  /** 2-3 sentences of LLM-authored interpretation of why it matters. */
  interpretation: string
  /** Concrete evidence line — counts, orgs, dollars — the reader can verify. */
  evidence: string
  /** Which detector surfaced this — used for de-duplication + downstream ranking. */
  category:
    | 'translation-gap-org'
    | 'isolated-top-funded-pi'
    | 'publications-vs-trials'
    | 'broader-nih-gap'
    | 'recency-skew'
}

/** Input bundle for surprise detection. */
export interface SurpriseDetectionContext {
  topic: string
  agentOutputs: AllAgentOutputs
  fundingStats: FundingStats
  topOrganizations: OrgStats[]
  topResearchers: ResearcherStats[]
  whiteSpace: WhiteSpaceAnalysis
}

interface DetectedCandidate {
  category: SurprisingFinding['category']
  headline: string
  evidence: string
  strength: number
}

const MAX_FINDINGS = 4
const MIN_FUNDING_FOR_TRANSLATION_GAP = 3_000_000 // $3M
const MIN_PUBS_FOR_TRANSLATION_GAP = 800 // large sample threshold
const MIN_BROADER_NIH_RATIO_SURPRISE = 100 // 100x broader vs sample

/**
 * Public entry point. Detects candidate anomalies, ranks by strength,
 * asks the LLM to narrate the top N. Returns a possibly-empty array —
 * a well-behaved report might genuinely have no surprises.
 */
export async function detectSurprisingFindings(
  ctx: SurpriseDetectionContext,
  usageTracker: UsageTracker,
): Promise<SurprisingFinding[]> {
  const candidates = [
    ...detectTranslationGapOrgs(ctx),
    ...detectIsolatedTopFundedPIs(ctx),
    ...detectPublicationsVsTrials(ctx),
    ...detectBroaderNihGaps(ctx),
    ...detectRecencySkew(ctx),
  ]

  if (candidates.length === 0) return []

  candidates.sort((a, b) => b.strength - a.strength)

  // Diversify by category — a single high-strength detector shouldn't
  // crowd out the others. Cap MAX_PER_CATEGORY and fall back to plain
  // top-N once each category has hit its cap.
  const MAX_PER_CATEGORY = 2
  const perCategoryCount = new Map<string, number>()
  const diversified: DetectedCandidate[] = []
  const overflow: DetectedCandidate[] = []
  for (const c of candidates) {
    const count = perCategoryCount.get(c.category) || 0
    if (count < MAX_PER_CATEGORY && diversified.length < MAX_FINDINGS) {
      diversified.push(c)
      perCategoryCount.set(c.category, count + 1)
    } else {
      overflow.push(c)
    }
  }
  // If we still have room, fill with the highest-strength leftovers.
  while (diversified.length < MAX_FINDINGS && overflow.length > 0) {
    diversified.push(overflow.shift()!)
  }

  return await narrateFindings(ctx.topic, diversified, usageTracker)
}

// -----------------------------------------------------------------------
// Detectors
// -----------------------------------------------------------------------

function detectTranslationGapOrgs(ctx: SurpriseDetectionContext): DetectedCandidate[] {
  const results: DetectedCandidate[] = []
  for (const org of ctx.topOrganizations.slice(0, 10)) {
    if (org.funding < MIN_FUNDING_FOR_TRANSLATION_GAP) continue
    if (org.trials > 0 || org.patents > 0) continue
    const orgDisplay = normalizeOrgName(org.org_name)
    // Substantial funding + active publishing + no patents + no trials.
    // The publication count matters for the reader: without it the finding
    // reads as "org has funding but no output," which is misleading —
    // these orgs typically ARE producing research (papers), just not IP
    // or clinical validation. Including publications reframes correctly
    // as "publishing but hasn't crossed into commercialization" (real
    // translation-gap pattern) rather than "silent lab" (which would be
    // untrue and unfair to the institution).
    const pubs = org.publications ?? 0
    const pubsPart = pubs > 0 ? `${pubs} linked publications, ` : ''
    const headline = pubs > 0
      ? `${orgDisplay} publishes actively (${pubs} linked pubs) but has no linked patents or trials`
      : `${orgDisplay} has substantial funding but no linked patents or trials`
    results.push({
      category: 'translation-gap-org',
      headline,
      evidence: `${org.projects} projects, $${(org.funding / 1_000_000).toFixed(1)}M in NIH funding, ${pubsPart}0 linked trials, 0 linked patents in the analyzed sample`,
      strength: org.funding / 1_000_000,
    })
  }
  return results
}

function detectIsolatedTopFundedPIs(ctx: SurpriseDetectionContext): DetectedCandidate[] {
  const results: DetectedCandidate[] = []
  const topPIs = ctx.topResearchers.slice(0, 5)
  for (const pi of topPIs) {
    if (pi.projects !== 1) continue
    if (pi.funding < 2_000_000) continue // $2M+ threshold
    const piDisplay = normalizePIName(pi.pi_name)
    const orgDisplay = pi.org ? normalizeOrgName(pi.org) : 'unknown org'
    results.push({
      category: 'isolated-top-funded-pi',
      headline: `${piDisplay} carries $${(pi.funding / 1_000_000).toFixed(1)}M on a single project, no adjacent follow-on`,
      evidence: `1 project, $${(pi.funding / 1_000_000).toFixed(1)}M, at ${orgDisplay}`,
      strength: pi.funding / 1_000_000,
    })
  }
  return results
}

function detectPublicationsVsTrials(ctx: SurpriseDetectionContext): DetectedCandidate[] {
  const pubs = ctx.agentOutputs.publications.items.length
  const trials = ctx.agentOutputs.trials.items.length
  if (pubs < MIN_PUBS_FOR_TRANSLATION_GAP) return []
  const ratio = trials > 0 ? pubs / trials : pubs
  if (ratio < 30) return [] // 30 pubs per trial threshold — arbitrary but meaningful

  return [
    {
      category: 'publications-vs-trials',
      headline: `Publication volume far exceeds clinical translation activity`,
      evidence: `${pubs.toLocaleString()} linked publications vs ${trials} linked trials (${ratio.toFixed(0)}x)`,
      strength: Math.min(50, ratio / 3),
    },
  ]
}

function detectBroaderNihGaps(ctx: SurpriseDetectionContext): DetectedCandidate[] {
  const results: DetectedCandidate[] = []
  for (const dim of ctx.whiteSpace.dimensions) {
    for (const cat of dim.categories) {
      if (cat.broaderNihCount === -1) continue
      if (cat.broaderNihCount < 200) continue // meaningful broader activity floor
      const ratio = cat.projectCount > 0 ? cat.broaderNihCount / cat.projectCount : cat.broaderNihCount
      if (ratio < MIN_BROADER_NIH_RATIO_SURPRISE) continue

      // Avoid false-precision framing that invites reviewer discredit.
      // A "1,498x" ratio built on a denominator of one project isn't a
      // robust measure — small changes to the topic classifier could
      // swing it to 500x or 5000x. Prefer raw counts in the headline,
      // and round the ratio to at most 2 significant figures. See Opus
      // review 2026-07-09 for the full framing critique.
      const roundedRatio = ratio >= 100 ? Math.round(ratio / 100) * 100 : Math.round(ratio / 10) * 10
      const magnitudeHint = ratio >= 500
        ? `over ${roundedRatio.toLocaleString()}x`
        : `~${roundedRatio}x`
      const headline =
        cat.projectCount <= 1
          ? `Only ${cat.projectCount} topic project vs ~${cat.broaderNihCount.toLocaleString()} broader NIH matches in "${cat.name}" (${dim.name})`
          : `${cat.projectCount} topic projects vs ~${cat.broaderNihCount.toLocaleString()} broader NIH matches (${magnitudeHint}) in "${cat.name}" (${dim.name})`

      // Penalize thin denominators in strength ranking. A category with
      // sample=1 scores lower than sample=5 at the same ratio because
      // the singleton case is more likely to be a classification artifact
      // than a meaningful gap. sqrt() keeps the effect proportional.
      const denominatorStability = Math.sqrt(cat.projectCount + 1)
      const rawStrength = Math.min(60, ratio / 2)
      results.push({
        category: 'broader-nih-gap',
        headline,
        evidence: `${cat.projectCount} projects in the topic sample vs ~${cat.broaderNihCount.toLocaleString()} matching projects across the broader NIH portfolio (title-only broader search — actual broader activity may be higher)`,
        // Cap strength so no single detector dominates.
        strength: Math.min(60, (rawStrength * denominatorStability) / 3),
      })
    }
  }
  return results
}

function detectRecencySkew(ctx: SurpriseDetectionContext): DetectedCandidate[] {
  const byYear = ctx.fundingStats.byYear
  if (byYear.length < 2) return []

  const currentFY = ctx.fundingStats.currentFY
  const priorYear = currentFY ? byYear.find((y) => y.year === currentFY - 1) : undefined
  const priorPriorYear = currentFY ? byYear.find((y) => y.year === currentFY - 2) : undefined
  if (!priorYear || !priorPriorYear) return []

  const change = priorYear.funding - priorPriorYear.funding
  const pctChange = priorPriorYear.funding > 0 ? change / priorPriorYear.funding : 0

  if (Math.abs(pctChange) < 0.4) return [] // <40% change not surprising

  const direction = pctChange > 0 ? 'jumped' : 'fell'
  const magnitude = `${(Math.abs(pctChange) * 100).toFixed(0)}%`
  return [
    {
      category: 'recency-skew',
      headline: `NIH funding ${direction} ${magnitude} from FY${priorPriorYear.year} to FY${priorYear.year}`,
      evidence: `FY${priorPriorYear.year}: $${(priorPriorYear.funding / 1_000_000).toFixed(1)}M across ${priorPriorYear.projects} projects; FY${priorYear.year}: $${(priorYear.funding / 1_000_000).toFixed(1)}M across ${priorYear.projects} projects`,
      strength: Math.min(50, Math.abs(pctChange) * 100),
    },
  ]
}

// -----------------------------------------------------------------------
// Narration
// -----------------------------------------------------------------------

async function narrateFindings(
  topic: string,
  candidates: DetectedCandidate[],
  usageTracker: UsageTracker,
): Promise<SurprisingFinding[]> {
  const listing = candidates
    .map(
      (c, i) => `${i + 1}. ${c.headline}
   Evidence: ${c.evidence}
   Category: ${c.category}`,
    )
    .join('\n\n')

  const prompt = `You are writing the "What Surprised Us" section of an intelligence report on "${topic}".

The following anomalies were detected algorithmically from the underlying data. For EACH one, write a 2-3 sentence interpretation explaining WHY IT MATTERS to a reader (researcher, investor, or biotech founder scoping this space). Reference the specific numbers in the evidence line.

Do NOT invent new anomalies or claim things that aren't in the evidence line. Only interpret what's given.

FRAMING NOTES:

**Universal caveat — apply to every finding.** The report analyzes NIH-linked data. Trials, patents, and publications only appear in the sample if they carry an NIH project-number acknowledgment. This gating means:
- Absence of patents/trials linked to an org does NOT prove the org has no IP or trials. Commercial patents, international filings, industry-sponsored trials, and non-NIH-funded work are structurally invisible to this dataset.
- Do NOT infer a broad "commercial gap" or "IP whitespace" from NIH-linked counts alone. Any interpretation of missing downstream milestones must acknowledge this gating.
- When you frame a finding around missing trials/patents, always include a phrase like "in the NIH-linked sample" or "within the scope of this analysis" — not just "no patents" as if that were an unqualified fact.

- For **translation-gap-org** findings: if the evidence line includes "linked publications", the org IS publishing actively. Frame the finding as "publishing but not commercializing/trialing WITHIN THIS NIH-LINKED SAMPLE" (a real translation gap between discovery and downstream milestones visible here), NOT as "silent" or "no output" or "no IP anywhere." The publication count is your evidence the research is happening; the missing patents/trials in THE SAMPLE are your evidence it hasn't crossed into IP or clinical validation visible through NIH acknowledgment. Acknowledge that commercial IP or industry-sponsored trials could exist outside this data.

- For **broader-nih-gap** findings: frame as a **flagged hypothesis**, not a certain opportunity.
  - When the topic-sample count is 0-2 projects, the ratio is directional not precise: a small change to how projects are classified in the topic sample could shift the count meaningfully. Say so explicitly. Use phrases like "these ratios are directional not precise at low denominators" or "the topic-slice count could shift with different classification choices."
  - Consider and briefly acknowledge alternate explanations: the gap could be a real underexplored intersection, OR it could be a taxonomy artifact (the topic classifier missing work filed under adjacent terminology like cfDNA, cell-free, metagenomics), OR it could be a domain where the biology is genuinely hard (e.g., microbial contamination in low-biomass blood samples is a known challenge for microbiome-in-blood work).
  - Do NOT call an opportunity "unexplored" unless you also note the alternate explanations. Prefer phrases like "flagged as a candidate whitespace pending taxonomy verification" or "worth investigating whether the low count reflects a real gap or a classification miss."
  - When broaderNihCount is preceded by a tilde (~) it's a rounded figure. Use approximate language ("roughly", "on the order of") to match.
  - Do NOT extrapolate a regional or geographic pattern from 2 or 3 data points. Two institutions in the same state are not "a regional dynamic" — they're two data points. If the detector surfaces multiple orgs, treat them as separate findings unless you have strong shared context beyond geography.

## DETECTED ANOMALIES

${listing}

## OUTPUT FORMAT — JSON only

Return exactly this shape:
{
  "findings": [
    {
      "headline": "<use the detector's headline verbatim OR minimally rephrase for readability>",
      "interpretation": "2-3 sentences on why this matters and what a reader should take from it",
      "evidence": "<use the detector's evidence line verbatim>",
      "category": "<use the detector's category verbatim>"
    }
  ]
}

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.`

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: MODEL,
      // 4 findings × ~500 chars of interpretation = ~2000 tokens output.
      // 2000 is comfortable; keep timeout tight so this can't drag out
      // the full report generation.
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 60_000,
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') return []
    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return []
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed || !Array.isArray(parsed.findings)) return []

    return parsed.findings
      .map((f: unknown) => {
        const finding = f as Partial<SurprisingFinding>
        if (
          !finding.headline ||
          !finding.interpretation ||
          !finding.evidence ||
          !finding.category
        ) {
          return null
        }
        return {
          headline: finding.headline,
          interpretation: finding.interpretation,
          evidence: finding.evidence,
          category: finding.category,
        } as SurprisingFinding
      })
      .filter((f: SurprisingFinding | null): f is SurprisingFinding => f !== null)
  } catch (err) {
    console.error('[Surprising Findings] Narration failed:', err)
    return []
  }
}
