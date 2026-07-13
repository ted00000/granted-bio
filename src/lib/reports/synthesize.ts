// Synthesis Agent
// Combines all agent outputs into a cohesive markdown report

import type {
  AllAgentOutputs,
  ReportData,
  ReportPersona,
  FundingStats,
  OrgStats,
  ResearcherStats,
  ProjectItem,
  TrialItem,
  PatentItem,
  PublicationItem,
  MarketContext,
  SignalsAnalysis,
  InvestorRiskFactors,
  CuratedPublication,
  FieldMaturityAssessment,
  CompetitiveTopology,
  IPLandscapeAssessment,
  WhiteSpaceAnalysis,
} from './types'
import { logApiUsage } from '@/lib/billing/usage'
import { generateWhiteSpaceAnalysis } from './white-space'
import { filterTrialsAndPatentsByRelevance } from './relevance-filter'
import { detectSurprisingFindings, type SurprisingFinding } from './surprising'
import { normalizeConfidenceTagSpacing } from './confidence-tags'
import { sanitizeText } from './sanitize'
import { applyPostRenderSubstitutions, stripPiPossessives } from './post-render'
import { normalizeOrgName, normalizeJournalName } from '@/lib/format-names'

interface SynthesisContext {
  userId: string
  fundingStats: FundingStats
  topOrganizations: OrgStats[]
  topResearchers: ResearcherStats[]
  dataLimited?: boolean
  persona?: ReportPersona
  /** Human-chosen search interpretation, if the report was generated through the picker UI. */
  interpretation?: { semanticQuery: string; keywordQuery: string; label: string }
  /**
   * ISO timestamp when the report row was created (report.created_at).
   * Used as the "Generated:" date in markdown so it matches whatever the
   * UI / PDF header renders from the DB row — otherwise the synthesis-end
   * timestamp can cross midnight UTC and the two surfaces show different
   * dates on a paid product (r26 audit finding).
   */
  generatedAt?: string
}

// Track cumulative token usage across all synthesis API calls
interface UsageTracker {
  inputTokens: number
  outputTokens: number
}

interface SectionInsights {
  funding: string
  clinicalPipeline: string
  patents: string
  publications: string
}

/**
 * Synthesize all agent outputs into a complete report
 */
export async function synthesizeReport(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext
): Promise<ReportData> {
  const persona = context.persona || 'researcher'
  console.log(`[Synthesis Agent] Generating ${persona} report for "${topic}"`)

  // Initialize usage tracker for all API calls
  const usageTracker: UsageTracker = { inputTokens: 0, outputTokens: 0 }

  const synthStart = Date.now()
  const stageTiming = (label: string) => {
    const elapsed = ((Date.now() - synthStart) / 1000).toFixed(1)
    console.log(`[Synthesis Agent] +${elapsed}s: ${label}`)
  }

  // Trial + patent topical relevance filter — runs first so downstream
  // synthesis steps (section insights, IP landscape, field maturity) see
  // only the topic-relevant subset instead of items that were pulled in
  // via NIH project linkage but are off-topic (e.g., a T-cell mediation
  // patent linked to a cancer biomarker project). Fails open — on error
  // all items are kept.
  stageTiming('start relevance filter')
  const relevanceResult = await filterTrialsAndPatentsByRelevance(
    topic,
    agentOutputs.trials.items,
    agentOutputs.patents.items,
    usageTracker,
  )
  stageTiming('relevance filter done')
  // Replace items with the filtered/sorted list. Recompute byPhase +
  // byStatus from the kept trials so the summary tables reflect what
  // the reader sees in the Active Trials listing.
  agentOutputs.trials.items = relevanceResult.trials
  agentOutputs.trials.byPhase = recomputeTrialsByPhase(relevanceResult.trials)
  agentOutputs.trials.byStatus = recomputeTrialsByStatus(relevanceResult.trials)
  agentOutputs.patents.items = relevanceResult.patents
  // Rebuild byAssignee from the kept patents so counts match what's
  // shown in the Key Patents list and IP Concentration section.
  agentOutputs.patents.byAssignee = recomputePatentsByAssignee(relevanceResult.patents)

  // Generate all LLM content in parallel (first batch)
  stageTiming('start main synthesis batch')
  const [executiveSummary, sectionInsights, signalsAnalysis, curatedPublications, enhancedMarketContext, fieldMaturity, competitiveTopology, ipLandscape, whiteSpace] = await Promise.all([
    generateExecutiveSummary(topic, agentOutputs, context, usageTracker),
    generateSectionInsights(topic, agentOutputs, context, usageTracker),
    generateSignalsAnalysis(topic, agentOutputs, context, usageTracker),
    generateCuratedPublications(topic, agentOutputs, context, usageTracker),
    enhanceMarketContext(topic, agentOutputs.market.context, context, usageTracker),
    generateFieldMaturityAssessment(topic, agentOutputs, context, usageTracker),
    generateCompetitiveTopology(topic, agentOutputs, context, usageTracker),
    generateIPLandscapeAssessment(topic, agentOutputs, context, usageTracker),
    generateWhiteSpaceAnalysis(topic, agentOutputs.projects.items, usageTracker, persona),
  ])
  stageTiming('main synthesis batch done')

  // Replace raw market context with enhanced version
  agentOutputs.market.context = enhancedMarketContext

  // Second batch — three post-batch synthesis steps in parallel. They
  // all depend on the first batch's outputs (executiveSummary for
  // project insights; whiteSpace + ipLandscape for surprising + next
  // steps) but not on each other, so we fire them concurrently.
  // Previously project insights ran sequentially, adding ~30s to the
  // critical path unnecessarily.
  stageTiming('start post-batch synthesis (project insights + surprising + next steps)')
  const [projectInsights, surprisingFindings, nextSteps] = await Promise.all([
    generateProjectInsights(
      topic,
      topFundedProjects(agentOutputs.projects.items, 10),
      executiveSummary,
      context,
      usageTracker,
    ).catch((err) => {
      console.warn('[Synthesis Agent] project insights failed, returning empty:', err)
      return {} as Record<string, string>
    }),
    detectSurprisingFindings(
      {
        topic,
        agentOutputs,
        fundingStats: context.fundingStats,
        topOrganizations: context.topOrganizations,
        topResearchers: context.topResearchers,
        whiteSpace,
      },
      usageTracker,
    ).catch((err) => {
      console.warn('[Synthesis Agent] surprising findings failed, returning empty:', err)
      return [] as SurprisingFinding[]
    }),
    generateNextSteps(topic, agentOutputs, context, whiteSpace, ipLandscape, usageTracker).catch((err) => {
      console.warn('[Synthesis Agent] next steps failed, returning empty:', err)
      return ''
    }),
  ])
  stageTiming('post-batch synthesis done')

  // Assemble markdown report with persona-aware structure
  const markdownContent = assembleMarkdown(topic, agentOutputs, context, executiveSummary, sectionInsights, signalsAnalysis, curatedPublications, fieldMaturity, competitiveTopology, ipLandscape, projectInsights, whiteSpace, surprisingFindings, nextSteps)

  // Run the deterministic report linter against the assembled markdown.
  // If critical violations fire and any are retry-eligible, attempt one
  // LLM correction pass (section-scoped) to fix them, then re-lint. If
  // violations remain after retry, log and ship. See ./lint-retry.ts
  // for correction machinery and ./lint-report.ts for the rule set.
  let finalMarkdown = markdownContent
  try {
    const { lintReport, formatViolations, partitionViolations } = await import('./lint-report')
    const { applyLintCorrections } = await import('./lint-retry')
    let violations = lintReport({
      markdown: finalMarkdown,
      agentOutputs,
      fundingStats: context.fundingStats,
      topResearchers: context.topResearchers,
      whiteSpace,
    })
    if (violations.length > 0) {
      const { critical, warnings } = partitionViolations(violations)
      console.warn(formatViolations(violations))
      console.warn(
        `[Report Linter] Initial pass: ${critical.length} critical, ${warnings.length} warning(s).`,
      )
      // If any critical violations fired, attempt a single retry pass.
      // applyLintCorrections rewrites section-scoped violations via
      // targeted LLM calls; body-wide violations already handled by
      // post-render substitution are skipped.
      //
      // Re-enabled (r38) now that synthesis runs on Inngest. The Vercel
      // 300s ceiling no longer applies to background functions - Inngest
      // functions can run as long as needed, and the retry pass's 60s
      // budget fits comfortably alongside base synthesis (~180-240s)
      // within a single Inngest step. AbortController still enforces
      // per-call timeouts inside lint-retry, so a hung request can't
      // stall the whole run.
      const retryEnabled = process.env.LINT_RETRY_ENABLED !== 'false'
      if (critical.length > 0 && retryEnabled) {
        const corrected = await applyLintCorrections(
          finalMarkdown,
          violations,
          topic,
          usageTracker,
        )
        if (corrected !== finalMarkdown) {
          finalMarkdown = corrected
          // Re-lint against the corrected markdown. Log the delta.
          const post = lintReport({
            markdown: finalMarkdown,
            agentOutputs,
            fundingStats: context.fundingStats,
            topResearchers: context.topResearchers,
            whiteSpace,
          })
          const postPart = partitionViolations(post)
          console.log(
            `[Report Linter] After retry: ${postPart.critical.length} critical (was ${critical.length}), ${postPart.warnings.length} warning(s) (was ${warnings.length}).`,
          )
          if (post.length > 0) {
            console.warn(formatViolations(post))
          }
          violations = post
        }
      }
    } else {
      console.log('[Report Linter] All rules passed on first pass.')
    }
  } catch (err) {
    // Linter should never break report generation. Log and continue.
    console.warn('[Report Linter] Failed to run:', err)
  }
  // Rebind markdownContent to the corrected version for downstream
  // consumers (DB write, return value).
  const finalMarkdownContent = finalMarkdown

  // Log cumulative API usage for billing
  console.log(`[Synthesis Agent] Total API usage: ${usageTracker.inputTokens} input, ${usageTracker.outputTokens} output tokens`)
  await logApiUsage({
    userId: context.userId,
    endpoint: 'report',
    persona: persona,
    inputTokens: usageTracker.inputTokens,
    outputTokens: usageTracker.outputTokens,
  })

  return {
    executiveSummary,
    marketContext: agentOutputs.market.context,
    fundingStats: context.fundingStats,
    projects: agentOutputs.projects.items.slice(0, 20),
    clinicalTrials: agentOutputs.trials.items,
    patents: agentOutputs.patents.items,
    publications: agentOutputs.publications.items,
    topOrganizations: context.topOrganizations,
    topResearchers: context.topResearchers,
    markdownContent: finalMarkdownContent,
    persona,
    signalsAnalysis,
    curatedPublications,
    surprisingFindings,
    nextSteps,
    fieldMaturity,
    competitiveTopology,
    ipLandscape,
    whiteSpace,
  }
}

/**
 * Generate executive summary using LLM
 * Focused on STRATEGIC insights, not data repetition
 */
async function generateExecutiveSummary(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  // Count precise matches for Claude's context
  const preciseCount = agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length
  const balancedCount = agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length

  // Determine dominant category for context
  const topCategory = context.fundingStats.byCategory[0]?.category || 'research'

  // Pre-compute trial status split so the Exec Summary can't overstate
  // "N active or completed" by including terminated/suspended/withdrawn.
  // r29 audit flagged the Exec Summary saying "60 clinical trials are
  // active or completed" when the status table showed 14 were
  // terminated/suspended/withdrawn (only 46 were actually active or
  // completed).
  // 3-way trial status split. r34 audit caught the previous 2-way split
  // dropping "Not Yet Recruiting" into activeOrCompleted, which made
  // "N are active or completed" numerically wrong (a NYR trial hasn't
  // started, so it isn't active). Now split into: active/completed
  // (running or done), not-yet-started (approved but not open),
  // terminated (failed/withdrawn/suspended), other (unknown/available/
  // etc). Prompt hard-forces all four to sum to the total.
  const trialStatusCounts = {
    activeOrCompleted: 0,
    notYetStarted: 0,
    terminated: 0,
    other: 0,
  }
  const ACTIVE_STATUSES = new Set([
    'active, not recruiting',
    'recruiting',
    'enrolling by invitation',
    'completed',
  ])
  const NOT_YET_STATUSES = new Set(['not yet recruiting', 'approved for marketing'])
  const TERMINATED_STATUSES = new Set(['terminated', 'suspended', 'withdrawn'])
  for (const t of agentOutputs.trials.items) {
    const s = (t.study_status || '').toLowerCase().trim()
    if (ACTIVE_STATUSES.has(s)) trialStatusCounts.activeOrCompleted++
    else if (NOT_YET_STATUSES.has(s)) trialStatusCounts.notYetStarted++
    else if (TERMINATED_STATUSES.has(s)) trialStatusCounts.terminated++
    else trialStatusCounts.other++
  }
  const totalTrialsForSummary = agentOutputs.trials.items.length

  const trialSummaries = agentOutputs.trials.items
    .slice(0, 15)
    .map((t) => `- ${t.study_title} (${t.phase || 'Phase N/A'}, ${t.study_status || 'Status N/A'}) - ${t.lead_sponsor || 'Sponsor N/A'}`)
    .join('\n')

  const patentSummaries = agentOutputs.patents.items
    .slice(0, 10)
    .map((p) => `- ${p.patent_title} (${p.assignee || 'Unknown'})`)
    .join('\n')

  // Persona-specific framing
  const personaContext = persona === 'investor'
    ? `You are writing for an INVESTOR evaluating commercial opportunity. Focus on:
- Market opportunity signals (where is money flowing, what's being protected)
- Technology readiness (how close to commercialization)
- Competitive dynamics (who's ahead, who's differentiated)
- Risk factors (what could prevent success)`
    : `You are writing for a RESEARCHER understanding the competitive landscape. Focus on:
- Scientific positioning (what approaches exist, where are gaps)
- Collaboration opportunities (who's doing complementary work)
- Methodological trends (what techniques are emerging)
- Field momentum (accelerating, maturing, or stalling)`

  const prompt = `${personaContext}

## TOPIC: ${topic}
${partialFYPromptDirective(context.fundingStats)}

## FUNDING BY YEAR (most recent first)
${formatYearTrendForPrompt(context.fundingStats.byYear)}

## DATA SUMMARY — VERBATIM NUMBERS (use these EXACT figures when writing percentages; do NOT approximate)
- Total projects: ${context.fundingStats.projectCount} (${preciseCount} Precise-tier, ${balancedCount} Balanced-tier)
- Total funding: ${formatCurrency(context.fundingStats.total)} across ${context.fundingStats.orgCount} organizations
- **Trial status split (use the itemized status counts below verbatim; do NOT collapse them into a "N active or completed" bucket):**
  - Recruiting: ${agentOutputs.trials.byStatus?.['Recruiting'] || 0}
  - Active, not recruiting: ${agentOutputs.trials.byStatus?.['Active, not recruiting'] || 0}
  - Enrolling by invitation: ${agentOutputs.trials.byStatus?.['Enrolling by invitation'] || 0}
  - Completed: ${agentOutputs.trials.byStatus?.['Completed'] || 0}
  - Not yet recruiting: ${agentOutputs.trials.byStatus?.['Not yet recruiting'] || 0}
  - Terminated: ${agentOutputs.trials.byStatus?.['Terminated'] || 0}
  - Suspended: ${agentOutputs.trials.byStatus?.['Suspended'] || 0}
  - Withdrawn: ${agentOutputs.trials.byStatus?.['Withdrawn'] || 0}
  - Total: ${totalTrialsForSummary}
- **STRONGLY PREFERRED: COMPACT FRAMING.** Cite trial status using this exact compact template: "${totalTrialsForSummary - trialStatusCounts.terminated} trials in progress, planned, or completed vs ${trialStatusCounts.terminated} terminated/suspended/withdrawn (${totalTrialsForSummary} total)". This form uses the terminated bucket as the anchor (unambiguous negative counts) and always sums correctly to the total. Every audit finds a new way that itemized enumeration goes wrong (dropped categories, incorrect negations, arithmetic slips), so USE THIS COMPACT FORM unless you have a strong specific reason not to.
- **IF you must itemize instead of using the compact form**: enumerate ALL non-zero status categories such that the cited counts sum to ${totalTrialsForSummary} EXACTLY. Sum before writing. If your itemization doesn't sum to ${totalTrialsForSummary}, use the compact form instead. Do NOT partially itemize (citing 4-5 categories but missing 2-3). Do NOT negate absent categories ("with no trials in X") - readers understand unlisted = absent. Every itemization must sum exactly to ${totalTrialsForSummary}.
- **NO PHRASE "N ACTIVE OR COMPLETED".** That label is ambiguous; readers disagree on whether "recruiting" counts as "active".
- **NO OVERLAPPING SUBTOTALS.** Do NOT cite two different subtotals of the same base in the same passage. Example of what's banned: "15 terminated, suspended, or withdrawn (69 total)... terminated and suspended trials (12 combined)." Even if both numbers are correct in isolation (T+S+W=15 AND T+S=12), citing both in one passage makes readers see contradiction. Pick ONE framing per passage (either "15 terminated/suspended/withdrawn" OR "10 terminated + 2 suspended + 3 withdrawn" broken out) and stay with it.
- Do NOT attribute the terminated count to any specific cause ("assay attrition", "assay failure", "clinical failure") without corroborating evidence. If you mention terminations, frame as "worth monitoring" or "warrants investigation."
- Clinical trials: ${agentOutputs.trials.items.length} | Patents: ${agentOutputs.patents.items.length}
- **Category shares** (project count share of ${context.fundingStats.projectCount} total — use these EXACT percentages if you cite a category share):
${context.fundingStats.byCategory
  .slice(0, 6)
  .map(
    (c) =>
      `  - ${formatCategory(c.category)}: ${c.projects} projects (${((c.projects / Math.max(context.fundingStats.projectCount, 1)) * 100).toFixed(1)}%), ${formatCurrency(c.funding)}`,
  )
  .join('\n')}
- Dominant category: ${formatCategory(topCategory)}

## FULL PROJECT LIST (all ${agentOutputs.projects.items.length} projects — title + org + category, one per line)
${formatAllProjectsCompact(agentOutputs.projects.items)}

## RESEARCH ABSTRACTS (top ${Math.min(30, agentOutputs.projects.items.length)} by funding — scan for patterns, don't describe individual projects)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 30))}

## CLINICAL DEVELOPMENT
${trialSummaries || 'No trials identified'}

## IP ACTIVITY
${patentSummaries || 'No patents identified'}

## MARKET CONTEXT
${agentOutputs.market.context.overview}

---

## YOUR TASK: Write a TIGHT, 3-paragraph strategic executive summary

Rules of thumb (from a critical reviewer):
- **Lead with 2-3 hard quantitative findings**, not with narrative abstraction. Numbers first, interpretation second. The reader has a data-rich report below — the summary should previews the hardest findings, not float above them.
- **Concise. ~250 words total across all three paragraphs.**
- **NO AI tell-tale phrases.** Banned list — do not use, ever:
  - "at a strategic inflection point" / "inflection point"
  - "step-change" / "methodological step-change"
  - "genuine scientific opportunity" / "genuine opportunity" / "genuine methodological opportunity" / "genuine biological differentiation" / any "genuine [noun]" pattern where "genuine" is a modifier on a claim about the field
  - "perhaps most critically"
  - "underscores"
  - "poised to"
  - "landscape reveals"
  These phrases mark AI-generated prose immediately and destroy credibility. "Genuine X" in particular reads as puffery — say what X actually is instead.
- **Ban vague qualifiers.** Replace "significantly", "substantially", "meaningfully" with actual numbers or drop the sentence.
- **Frame observations as observations, not verdicts.** "5 of the top 10 orgs are academic" - good. "The field is accelerating" from a two-point FY trend - hedge: "FY2025 funding was higher than FY2024, but a two-point trend is not by itself proof of acceleration."
- **TWO-POINT TREND HEDGE - REQUIRED, not optional.** If you cite two years of funding side-by-side (e.g. FY2024 $Xm and FY2025 $Ym), you MUST append the hedge "though two data points do not establish a trend" (or equivalent) in the SAME sentence or paragraph. Do NOT write "suggests growing NIH commitment", "suggests accelerating investment", "signals sustained growth", or any trend verb ("rose", "grew", "climbed", "up") without the hedge attached. This rule applies to Exec Summary paragraph 1 (data facts) as much as anywhere else - the hedge is not narrative flourish, it's a factual constraint on what 2 points can show.
- **NUMERIC RIGOR — CRITICAL.** Any percentage or share claim you write MUST come from the "Category shares" list in the DATA SUMMARY above (VERBATIM), or from a table shown below in the report. NEVER approximate. If you want to say "diagnostics-heavy," write "diagnostics account for 60.2% of projects (74 of 123)" not "roughly 70%." If the exact figure isn't in the DATA SUMMARY or a body table, do not write the percentage — describe the pattern qualitatively instead ("diagnostics-dominant"). Loose approximations get spotted in ten seconds by a reader who checks the byCategory table.
- **TAXONOMY SOURCE — name it every time.** The "Category shares" numbers above come from ONE specific taxonomy (the project **funding category** classifier — e.g. "Diagnostics", "Basic Research", "Biotools", "Medical Device"). The White Space section (rendered later in the report) uses a DIFFERENT taxonomy — dimension-based coverage classes like "Biomarker Discovery / Mechanistic Biology". A reader cross-referencing sections will see similar-sounding categories with DIFFERENT counts and reasonably ask "which is which." When you cite a category count in the Executive Summary, you MUST name the taxonomy source in the same sentence. Concrete examples: "5 projects (4.1%) fall in the Basic Research funding category" — GOOD. "5 projects on basic research into cfDNA biogenesis mechanisms" — BAD (invites the reader to compare against the White Space "Biomarker Discovery" count of 4 projects and find a contradiction that isn't one — they're different taxonomies). Rules: (a) use the phrase "funding category" whenever citing byCategory counts; (b) do NOT describe a byCategory count as "the mechanistic gap", "the discovery gap", or any concept-based framing that overlaps with a White Space dimension; (c) if you want to describe a mechanistic/discovery gap, either cite the White Space count directly (once White Space is rendered below) OR use language that doesn't collide with the byCategory names.
- **CROSS-TAXONOMY COLLISION.** Do NOT invoke both taxonomies' counts on the same conceptual gap ("mechanistic", "basic research", "discovery") in the same paragraph. If the funding-category shows Basic Research = 5 and the White Space shows Biomarker Discovery / Mechanistic Biology = 1, DO NOT cite both without an explicit disambiguation sentence. Concrete rule: if you say "5 projects in the Basic Research funding category" and later invoke "the mechanistic gap", the reader will scroll to White Space, see "1 project", and think the report contradicts itself. Fix: either restrict yourself to ONE taxonomy per gap-related claim, or explicitly write "the Basic Research funding category (5 projects) and the White Space Biomarker Discovery / Mechanistic Biology dimension (1 project) measure different things — one is the NIH activity code, the other is a translational-stage classifier." Never let two counts float unattributed.

Three paragraphs, in this order:

**Paragraph 1 - What the data actually shows.** Two or three hardest quantitative facts (funding total + project count + phase distribution + top org concentration). Structure: "Of X projects totaling $YM, Z% cluster around approach A, W trials are in Phase B or later, top P orgs hold Q% of total funding." Concrete.

**Paragraph 2 - Where the interesting cleavages are.** Point at 2-3 concrete positioning observations from the data (specific approaches, specific institutional strategies, specific gaps). Reference actual project numbers or org names where the observation IS about institutional concentration (that's factual signal). Do NOT abstract to "the field is..." — say "Of the 5 methodological clusters identified, X and Y dominate; Z is present but thin."

**Paragraph 3 - What a ${persona} should take away.** 2-3 concrete watchpoints, not generic advice. Tie each to something specific in the data. For researcher: which grant mechanisms and collaborators to consider given the funded landscape. For investor: what technical/clinical milestones matter and what commercial signals to watch.

**DESCRIPTIVE vs PRESCRIPTIVE — critical rule for how you use organization names.** Named orgs are FINE when you're describing factual concentration ("Johns Hopkins, UCLA, Stanford together hold 40% of large awards"). Named orgs are NOT fine when you're prescribing action toward them ("Johns Hopkins is an obvious collaboration target", "UCLA would be receptive to outreach", "engage with the MGH cluster"). The report is read by the same community it describes — telling readers who to approach reads as calling those orgs out. Rewrite prescriptive framing as pattern-level observations: "the concentration of MCED work in a small set of nodes means differentiation requires a genuinely novel angle" (pattern), not "researchers should approach the JH/UCLA/Mayo cluster" (targeting). Never name individual PIs in the summary at all — PI names belong in the Key Researchers table, not the executive narrative.

OUTPUT FORMAT: Three paragraphs, no headings, no bullet points. Do NOT start with a heading.

SAMPLE-BASED LANGUAGE (still required):
- "Among the projects analyzed..." not "The field has..."
- Prefer "the sample shows" over "the field is"
- Acknowledge NIH-linked scope where it materially affects the reading

**BANNED FIELD-LEVEL ABSOLUTES.** These phrases assert facts about the whole field that the NIH-linked sample cannot support (private industry cfDNA work, ex-US research, and non-NIH federal funding are structurally invisible). Do NOT use:
- "a clear gap exists" / "clear gap in X" / "clear methodological gap" / "clear point-of-care gap" / any "clear [adjective] gap" or "clear gap in [X]" construction. Rewrite as "within the analyzed sample, X is sparse" or "the sample shows thin representation of X"
- "structural underfunding" / "structurally underfunded"
- "the field has abandoned X" / "X is neglected in the field"
- "unmet need" as a field-level claim (fine inside a quoted clinical unmet-need reference)
- Any construction where the sample share (e.g. "4.1% of project share") is used to argue a "structural" or "field-wide" fact.

Rewrite as observation-in-sample language: "Within the analyzed sample, non-plasma biofluids are sparse relative to their biological rationale" or "represents a low share of sample projects (X of Y); whether this reflects true underfunding or NIH-linked scope is not resolvable from this dataset." The observation is fine; the field-level verdict is not.

**BANNED FORWARD-LOOKING ABSOLUTES on market/regulatory/scientific dynamics.** Do NOT write "will pressure", "will force", "will drive", "will increase", "will accelerate", "will require", "will shift", or any similar future-tense absolute for outcomes derived from current events. Use "is likely to", "may pressure", "could shift", "creates pressure for" - matching the same hedge convention the report applies to funding trends and clinical readouts. Rule: any bare future-tense verb ("will ...") applied to an outcome not yet observed = fail. If you must write about a future state, use "is likely to" or "may" as the modal.

**NAMED-PRODUCT CLINICAL HONESTY (Dimension 2 — critical).** If you cite a named clinical program by name in the Executive Summary (GRAIL, Galleri, NHS-Galleri, PATHFINDER 2, Signatera, Shield, DELFI, MRDetect, etc), you MUST present the full picture:
- If a program has both positive AND negative readouts (like GRAIL's Galleri: NHS-Galleri missed primary endpoint AND PATHFINDER 2 showed 7-fold detection increase), cite BOTH in the same paragraph. Do NOT invoke only the miss as the "pivotal watchpoint" without also acknowledging the positive - single-sided framing on a mixed-result program is a Dimension 2 fail.
- If you're using the program as a strategic anchor (e.g., "post-Galleri recalibration toward earlier interception"), the anchor is invalid unless both sides are on the page.
- The Market Context section carries the full both-sides framing; the Executive Summary must not truncate it to just the negative.

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Track usage
  usageTracker.inputTokens += response.usage.input_tokens
  usageTracker.outputTokens += response.usage.output_tokens

  const textContent = response.content.find((c) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    return 'Executive summary could not be generated.'
  }

  return textContent.text
}

/**
 * Generate insights for each major section
 * Analyzes actual research content from abstracts for substantive insights
 */
async function generateSectionInsights(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<SectionInsights> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  // Prepare ALL patent abstracts for substantive analysis (full throttle: 25)
  const patentAbstracts = agentOutputs.patents.items
    .slice(0, 25)
    .map((p, i) => {
      return `[${i + 1}] "${p.patent_title}" (${p.assignee || 'Unknown assignee'})\nDate: ${p.patent_date || 'N/A'}\n${p.patent_abstract || 'No abstract available'}`
    })
    .join('\n\n---\n\n')

  // Prepare ALL publication abstracts for substantive analysis (full throttle: 25)
  const pubAbstracts = agentOutputs.publications.items
    .slice(0, 25)
    .map((p, i) => {
      const year = p.publication_date ? new Date(p.publication_date).getFullYear() : 'N/A'
      return `[${i + 1}] "${p.publication_title}" (${p.journal || 'Unknown journal'}, ${year})\n${p.abstract || 'No abstract available'}`
    })
    .join('\n\n---\n\n')

  // Prepare ALL trial details for clinical insights (full throttle: 25)
  const trialDetails = agentOutputs.trials.items
    .slice(0, 25)
    .map((t, i) => {
      const conditions = t.conditions?.join(', ') || 'N/A'
      return `[${i + 1}] "${t.study_title}"\nPhase: ${t.phase || 'N/A'} | Status: ${t.study_status || 'N/A'} | Sponsor: ${t.lead_sponsor || 'N/A'}\nConditions: ${conditions} | Enrollment: ${t.enrollment_count?.toLocaleString() || 'N/A'}`
    })
    .join('\n\n')

  const prompt = `You are analyzing research data for "${topic}" to generate substantive section insights for a research intelligence report.
${partialFYPromptDirective(context.fundingStats)}
CRITICAL FRAMING: This data represents a CURATED SAMPLE of ${context.fundingStats.projectCount} high-confidence NIH-funded projects (balanced+ match threshold), not the complete population. Use sample-appropriate language.

MATCH QUALITY TIERS:
- [PRECISE] (similarity ≥50%): Highly relevant to "${topic}" - weight these most heavily
- [BALANCED] (similarity ≥35%): Relevant - standard weight
Projects are ranked by relevance. Give more emphasis to insights from [PRECISE] and early-numbered projects.
When referring to tiers in your narrative output, use title case ("Precise", "Balanced") — the ALL-CAPS bracket form ([PRECISE] / [BALANCED]) is an internal tag only, do not echo it in prose.

---

## FULL PROJECT LIST (all ${agentOutputs.projects.items.length} projects — title + org + category, one per line)
${formatAllProjectsCompact(agentOutputs.projects.items)}

## PROJECT ABSTRACTS (top ${Math.min(25, agentOutputs.projects.items.length)} by funding — analyze for funding insight)

${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 25)) || 'No project abstracts available'}

**Sample Statistics:**
- Projects: ${context.fundingStats.projectCount} (${agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length} precise, ${agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length} balanced)
- Total Funding in Sample: ${formatCurrency(context.fundingStats.total)}
- Organizations: ${context.fundingStats.orgCount} | PIs: ${context.fundingStats.piCount}
- Top Categories: ${context.fundingStats.byCategory.slice(0, 3).map(c => `${c.category.replace(/_/g, ' ')} (${c.projects})`).join(', ')}
- Top Orgs: ${context.fundingStats.byOrg.slice(0, 3).map((o) => `${o.org}: ${formatCurrency(o.funding)}`).join(', ')}
- Funding by year: ${formatYearTrendForPrompt(context.fundingStats.byYear)}

---

## CLINICAL TRIALS (analyze for pipeline insight)

${trialDetails || 'No trials identified'}

**Trial Distribution:**
- By Phase: ${JSON.stringify(agentOutputs.trials.byPhase)}
- By Status: ${JSON.stringify(agentOutputs.trials.byStatus)}

---

## PATENT ABSTRACTS (analyze for IP insight)

${patentAbstracts || 'No patents identified'}

**Patent Statistics:**
- Total: ${agentOutputs.patents.items.length} | Recent (2yr): ${agentOutputs.patents.recentCount}
- Top Assignees: ${agentOutputs.patents.byAssignee.slice(0, 3).map((a) => `${a.assignee} (${a.count})`).join(', ') || 'N/A'}

---

## PUBLICATION ABSTRACTS (analyze for academic insight)

${pubAbstracts || 'No publications identified'}

**Publication Statistics:**
- Total: ${agentOutputs.publications.items.length}
- Top Journals: ${agentOutputs.publications.byJournal.slice(0, 3).map(j => `${j.journal} (${j.count})`).join(', ') || 'N/A'}

---

## YOUR TASK

Generate substantive insights for each section by analyzing the ACTUAL CONTENT above. Focus on:

1. **Funding**: What scientific approaches and methodologies are being funded? What therapeutic targets or mechanisms dominate? What does the research focus reveal about priorities?

2. **Clinical Pipeline**: What conditions are being targeted? What's the progression from early to late phase? What sponsors are advancing what types of interventions?

3. **Patents**: What innovations are being protected? What technical areas are generating IP? What does patent activity suggest about commercialization potential?

4. **Publications**: What scientific questions are being addressed? What methodological advances are being published? What journals suggest the field's maturity?

LANGUAGE REQUIREMENTS:
- Use "our analysis reveals", "among the examined projects", "the sample shows"
- AVOID definitive claims like "the field has X total" or "this proves"
- Use confident hedged language: "suggests", "indicates", "appears likely", "may reflect"
- "Among the linked patents..." not "The IP landscape is..."
- "This concentration pattern suggests..." not "Stanford controls..."
- Be SPECIFIC about observations but acknowledge this is a high-confidence sample, not complete census
- Each insight should be 3-4 sentences with real substance

CRITICAL DATA-GROUNDING RULE:
- If you make any claim about presence/absence or counting of specific topics (cancer types, diseases, biofluids, methodologies, organizations), verify against the FULL PROJECT LIST above — NOT the ABSTRACTS section, which is only a subset.
- Never say "no projects on X" or "only one project on Y" unless the FULL PROJECT LIST actually shows that. Prefer qualitative framing ("relatively underrepresented in the sample") when the count is nonzero but small.

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

TWO-POINT TREND HEDGE - REQUIRED: If the funding insight cites two consecutive FY dollar figures side-by-side (e.g. "FY2024 $X and FY2025 $Y"), you MUST append "though two data points do not establish a trend" or equivalent hedge in the SAME sentence. Do NOT write "suggests growing NIH commitment", "signals increased investment", "reflects a rising trajectory" - those are trend claims and 2 data points can't support them. This hedge is not optional prose polish; it's a factual constraint.

CLINICAL PIPELINE — DO NOT CHERRY-PICK STATUSES:
When writing the clinicalPipeline insight, do NOT selectively narrate encouraging statuses (Recruiting, Active) while ignoring negative ones. If the trial list contains any Terminated, Withdrawn, or Suspended trials, mention that too — either explicitly ("N terminated trials also in the sample, suggesting the field has seen setbacks") or by using neutral framing ("mixed status distribution including several terminated trials"). Cherry-picking is exactly the failure a reader spots by scanning the list below the narrative.

Return JSON only, no markdown:
{
  "funding": "3-4 sentences analyzing what researchers are actually working on and what the funding patterns reveal about scientific priorities",
  "clinicalPipeline": "3-4 sentences on what conditions are being targeted, intervention types, and progression through clinical development — INCLUDING any Terminated/Withdrawn/Suspended trials if present in the sample",
  "patents": "3-4 sentences on what innovations are being protected and what this indicates about translational potential",
  "publications": "3-4 sentences on what scientific questions are being addressed and methodological advances observed"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500, // Increased for richer section insights
      messages: [{ role: 'user', content: prompt }],
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return defaultInsights()
    }

    // Strip markdown fences before parsing. Claude reliably wraps JSON output
    // in ```json ... ``` even when instructed not to; without this strip the
    // bare JSON.parse throws and four section narratives silently vanish.
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Synthesis Agent] No JSON object found in section insights response')
      return defaultInsights()
    }

    const parsed = JSON.parse(jsonMatch[0])
    // Gibberish guard. r29 audit surfaced a Key Publications intro
    // ending in literal LLM corruption ("ihl tliid bifldttiifillhih flt
    // thbd idif th"). Not a code bug — a transient LLM emission that
    // shouldn't ship. Detects text with impossible consonant clusters
    // or a very low vowel ratio and replaces with an empty string so
    // the section falls back to just the disclaimer + curated
    // publications, not the corrupted narrative.
    return {
      funding: sanitizeInsight(parsed.funding),
      clinicalPipeline: sanitizeInsight(parsed.clinicalPipeline),
      patents: sanitizeInsight(parsed.patents),
      publications: sanitizeInsight(parsed.publications),
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate section insights:', error)
    return defaultInsights()
  }
}

/**
 * (Docstring for sanitize logic — implementation now lives in
 * ./sanitize.ts. Kept here for context.)
 * Reject narrative text that appears to be LLM gibberish. Three signals,
 * any of which triggers rejection (returns empty string):
 *   1. All-consonant tokens >=5 chars — normal English words have vowels.
 *   2. Low unique-character ratio in a token >=6 chars — real words
 *      rarely have unique-char/length below 0.4. "ihihhiiliil" has
 *      3 unique / 11 length = 0.27 — clear gibberish signal.
 *   3. Tokens with 3+ consecutive identical characters ("thbdd" etc)
 *      or obvious alternating patterns.
 *
 * Applied via sanitizeText() to every LLM-generated narrative field
 * (not just section insights). r31 audit surfaced garbled tokens in
 * strategicImplications ("ihihhiiliil lidi") and IP narrative
 * ("tillif thk thliid dttibiltfhthbd") that the previous rules didn't
 * catch because they contained vowels and were <7 chars.
 */
function sanitizeInsight(raw: unknown): string {
  return sanitizeText(raw, 'insight')
}

function defaultInsights(): SectionInsights {
  return {
    funding: '',
    clinicalPipeline: '',
    patents: '',
    publications: '',
  }
}

/**
 * Generate persona-specific signals analysis
 */
async function generateSignalsAnalysis(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<SignalsAnalysis> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  // Prepare data summaries for analysis
  const topCategory = context.fundingStats.byCategory[0]?.category || 'research'

  const orgFundingList = context.fundingStats.byOrg
    .slice(0, 10)
    .map((o) => `${o.org}: ${formatCurrency(o.funding)} (${o.projects} projects)`)
    .join('\n')

  const patentAssignees = agentOutputs.patents.byAssignee
    .slice(0, 10)
    .map((a) => `${a.assignee}: ${a.count} patents`)
    .join('\n')

  const trialPhases = Object.entries(agentOutputs.trials.byPhase)
    .map(([phase, count]) => `${phase}: ${count}`)
    .join(', ')

  const yearTrend = formatYearTrendForPrompt(context.fundingStats.byYear)
  const partialDirective = partialFYPromptDirective(context.fundingStats)

  const prompt = persona === 'investor'
    ? `Analyze this research landscape for "${topic}" from an INVESTOR perspective.

## DATA CONTEXT
- ${context.fundingStats.projectCount} NIH projects, ${formatCurrency(context.fundingStats.total)} total funding
- Dominant category: ${formatCategory(topCategory)}
- Clinical trials: ${agentOutputs.trials.items.length} (${trialPhases || 'none'})
- Patents: ${agentOutputs.patents.items.length} (recent 2yr: ${agentOutputs.patents.recentCount})

## FUNDING BY ORG
${orgFundingList}

## FUNDING TREND
${yearTrend}

## IP CONCENTRATION
${patentAssignees || 'No patent assignee data'}

## FULL PROJECT LIST (all ${agentOutputs.projects.items.length} projects in the analyzed sample — title + org + category, one per line)
${formatAllProjectsCompact(agentOutputs.projects.items)}

## PROJECT ABSTRACTS (sample for technology assessment — top ${Math.min(20, agentOutputs.projects.items.length)} by funding)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 20))}

---

Generate INVESTOR-FOCUSED signals analysis.${partialDirective}

CRITICAL DATA-GROUNDING RULE:
- The FULL PROJECT LIST above enumerates every project in the analyzed sample. Use it as the authoritative reference when making claims about what topics, cancer types, diseases, biofluids, or approaches ARE or ARE NOT present in the sample.
- NEVER make a counting claim (e.g., "only one project on X", "no projects address Y") based on the ABSTRACTS section alone — that's only a fraction of the sample. Scan the FULL PROJECT LIST first.
- If you make a numerical claim, it must be verifiable against the FULL PROJECT LIST. When uncertain, use qualitative framing ("relatively underrepresented", "appears sparse") rather than specific counts.

PROJECT CITATIONS:
- When you reference a specific project, cite it by NIH project_number (the first field on each FULL PROJECT LIST line) or by a distinctive fragment of the title. DO NOT use bracket-index citations like "project [21]" — those numbers mean nothing to the reader and cannot be looked up.

SAMPLE-BASED LANGUAGE: This covers NIH-linked data only, not complete market IP/trials. Use confident but hedged language:
- "Among the linked patents..." not "The IP landscape is..."
- "This pattern suggests..." or "The concentration may indicate..."
- "Based on the NIH sample, freedom to operate appears..." not definitive FTO claims
- Acknowledge limitations while providing actionable insight

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
After each substantive claim (an assertion about TRL, commercial readiness, IP concentration, risk, or comparables), append a formatted confidence/evidence block. Use this exact markdown pattern INLINE within the narrative field, at the end of the relevant sentence or paragraph:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts and references, e.g. "10 patents from 4 assignees, 0 in the last 2 years, indicating an aging IP position"]

Confidence scale:
- **High**: claim rests on ≥10 items or clear pattern with multiple corroborators.
- **Medium**: claim rests on 3-9 items OR a plausible pattern with one confounder.
- **Low**: claim rests on ≤2 items OR is a forward-looking inference not directly demonstrated.

Every claim MUST have a confidence tag + evidence line. Do not include claims you can't support with a count or specific reference.

Return JSON only:

{
  "trlAssessment": "2-3 sentences with confidence+evidence tags: Assess technology readiness. What percentage appears early-stage vs. clinical-ready? Are there clear paths to product?",
  "commercialReadiness": "2-3 sentences with confidence+evidence tags: How close to market? What's missing for commercialization? Any existing products?",
  "ipConcentration": "2-3 sentences with confidence+evidence tags: Who owns the IP landscape? Is it fragmented or concentrated? Freedom to operate concerns?",
  "riskFactors": {
    "scientific": "One sentence describing key scientific/technical risk (or null if none)",
    "regulatory": "One sentence describing regulatory pathway risk (or null if none)",
    "competitive": "One sentence describing competitive/market timing risk (or null if none)",
    "execution": "One sentence describing execution/team/capability risk (or null if none)",
    "overall": "One sentence summary of the most critical risk for investors"
  },
  "comparables": "2-3 sentences with confidence+evidence tags: What comparable technologies or companies exist? How have similar investments performed?"
}`
    : `Analyze this research landscape for "${topic}" from a RESEARCHER perspective.

## DATA CONTEXT
- ${context.fundingStats.projectCount} NIH projects, ${formatCurrency(context.fundingStats.total)} total funding
- Dominant category: ${formatCategory(topCategory)}
- Clinical trials: ${agentOutputs.trials.items.length}
- Publications: ${agentOutputs.publications.items.length}

## FUNDING BY ORG
${orgFundingList}

## FUNDING TREND
${yearTrend}

## FULL PROJECT LIST (all ${agentOutputs.projects.items.length} projects in the analyzed sample — title + org + category, one per line)
${formatAllProjectsCompact(agentOutputs.projects.items)}

## PROJECT ABSTRACTS (analyze for positioning — top ${Math.min(25, agentOutputs.projects.items.length)} by funding)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 25))}

---

Generate RESEARCHER-FOCUSED signals analysis.${partialDirective}

CRITICAL DATA-GROUNDING RULE:
- The FULL PROJECT LIST above enumerates every project in the analyzed sample. Use it as the authoritative reference when making claims about what topics, cancer types, diseases, biofluids, or approaches ARE or ARE NOT present in the sample.
- NEVER make a counting claim (e.g., "only one project on X", "no projects address Y") based on the ABSTRACTS section alone — that's only a fraction of the sample. Scan the FULL PROJECT LIST first.

PROJECT CITATIONS:
- When you reference a specific project, cite it by NIH project_number (e.g., "project R01CA123456") or by a distinctive fragment of the title (e.g., "the MAESTRO-Pool project"). The project_number is the first field on each FULL PROJECT LIST line.
- DO NOT use bracket-index citations like "project [21]" or "[15], [72]" — those numbers mean nothing to the reader and cannot be looked up.

DO NOT WRITE GAP OR WHITE SPACE ANALYSIS HERE. The dedicated "White Space Analysis" section (rendered separately) covers coverage gaps with a quantified, multi-dimensional data audit. Focus this section on positioning, collaboration, and methodological trends within what IS funded — leave gaps to the dedicated section.

SAMPLE-BASED LANGUAGE: This covers NIH-funded research, not all activity in this space. Use confident but hedged language:
- "Among the funded projects..." not "The field is..."
- "This pattern suggests..." or "The funding distribution indicates..."
- Acknowledge this represents publicly-funded academic research primarily

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

DESCRIPTIVE vs PRESCRIPTIVE — read carefully.
- Naming organizations is FINE when you are describing factual concentration or activity ("methylation appears across UCLA, Johns Hopkins, Stanford").
- Naming organizations is NOT FINE when you are prescribing action toward them ("MGH is a productive collaboration partner", "align with the Johns Hopkins cluster", "engage with UCLA researchers"). Rewrite as pattern-level observations: "the concentration of methylation work in a small set of nodes suggests differentiation requires a genuinely novel angle" — not a directive to approach any specific institution.
- **BANNED "hub" / "entry point" / "access node" / "resource node" framing near an institution name.** Do NOT write "MGH functions as a hub", "X is a methodologically diverse hub", "Y is a collaboration entry point", "Z serves as an access node", or use "gateway", "on-ramp", "portal", "resource node" next to an institution name. That framing tells the reader that org is a good target to approach - same prescriptive read as "reach out to". Rewrite as raw factual concentration ("MGH holds 10 projects across 5 methodological categories") without the hub/entry-point/access-node modifier.
- **BANNED "target" NOUN FORMS pointed at institutions or research groups.** Do NOT write "partnership target", "collaboration target", "engagement target", "high-value partnership target", "high-value collaboration target", "partnership targets", "targets for collaboration", or any "[noun] target" construction that reads as "here's who to pursue." Same rule for verbs: "target [institution X]", "target the [X] cluster", "target this group". Rewrite as pattern-level observation: "the concentration of [approach] work in a small set of nodes means differentiation requires a genuinely novel angle" or drop the recommendation and let the reader decide. Neutral words like "candidate" (as in "candidate approach") are fine; "candidate partner" or "candidate collaborator" is not - same prescriptive read.
- **BANNED "cross-pollination" / "creates conditions where [X]" / "plausible" framings when applied to a named institution.** Do NOT write "MGH's 10 projects create conditions where methodological cross-pollination is plausible", "X's concentration creates favorable conditions for Y", or "the [institution] cluster makes multi-project synergy plausible". Even without directive verbs, this framing markets the named institution as a productive hub - same prescriptive drift as "collaboration target". Rewrite as pure factual concentration ("MGH's 10 projects span 5 methodological categories - a concentration pattern in the analyzed sample") with NO downstream inference about what that concentration enables or invites.
- NEVER name individual principal investigators (PIs) by name in the collaborationSignals, positioningMap, or methodologicalTrends fields. No "PI Zhou at UCLA", no "Dr. Chen's group." The Key Researchers table already carries specifics; narrative sections stay at pattern level so no individual is singled out.
- Project numbers (5U01CA...) are fine to cite as provenance. Institution names are fine to cite as descriptors. PI names are OFF LIMITS in these narratives. Prescriptive framing toward named orgs is OFF LIMITS.
- **NAMED-PRODUCT SYMMETRY (clinical honesty).** If you cite a named commercial product by name (DELFI Diagnostics, GRAIL Galleri, Guardant Shield, Freenome, Exact/Cologuard, Natera Signatera, MRDetect, Foundation Medicine, Adaptive Biotech, etc), you MUST either (a) cite the negative or unresolved side of that product's evidence (specificity/PPV concerns, PMA delays, coverage denials, screening-population caveats) alongside any positive framing, or (b) restrict the mention to a factual description of what the product does. Do NOT write "DELFI's fragmentomics approach is well-timed" or "MRDetect's Phase results support X" without acknowledging that real-world / screening-population evidence for the same product is still developing. Single-sided named-product framing costs credibility with a domain reader who knows the landscape.

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
After each substantive claim (an assertion about position, collaboration pattern, or methodological trend), append a formatted confidence/evidence block. Use this exact markdown pattern INLINE within the narrative field, at the end of the relevant sentence or paragraph:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts and references, e.g. "17 projects, $14.2M funding, methylation appears across UCLA, Johns Hopkins, and Stanford"]

Confidence scale:
- **High**: claim rests on ≥10 projects, clear pattern, corroborated by multiple orgs.
- **Medium**: claim rests on 3-9 projects OR a plausible pattern that has one meaningful confounder (e.g. small sample, single-org concentration).
- **Low**: claim rests on ≤2 projects OR is a forward-looking inference not directly demonstrated by the data.

Every claim MUST have a confidence tag + evidence line. Do not include claims you can't support with a count or specific project reference from the FULL PROJECT LIST.

Return JSON only:

{
  "positioningMap": "2-3 sentences with confidence+evidence tags: What distinct approaches exist in this space? How might a new entrant differentiate?",
  "collaborationSignals": "2-3 sentences with confidence+evidence tags describing multi-method concentration patterns in the sample. Frame descriptively: which institutions hold multiple projects across distinct methodological categories? What does that concentration look like? Do NOT frame as 'who might be good collaborators' or use action verbs - the rendered section header is 'Multi-Method Concentration Patterns', not 'Collaboration Opportunities'. Purely observational.",
  "methodologicalTrends": "2-3 sentences with confidence+evidence tags: What techniques are emerging vs. mature? What methodological pattern stands out among the funded work?"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 2500 to leave real headroom for confidence+evidence tags —
      // investor persona has 5 fields × ~1000 tokens of added tag text,
      // and 2000 was landing tight enough that a chatty response would
      // truncate mid-JSON. Now that the sequential white-space bottleneck
      // is fixed, latency headroom exists; this only adds ~5s per call.
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    }, {
      // Hard per-call timeout so a slow LLM response can't consume the
      // entire serverless-function budget.
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return defaultSignals()
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Synthesis Agent] No JSON object found in signals response')
      return defaultSignals()
    }

    const parsed = JSON.parse(jsonMatch[0])

    if (persona === 'investor') {
      return {
        positioningMap: '',
        collaborationSignals: '',
        methodologicalTrends: '',
        trlAssessment: normalizeConfidenceTagSpacing(parsed.trlAssessment || ''),
        commercialReadiness: normalizeConfidenceTagSpacing(parsed.commercialReadiness || ''),
        ipConcentration: normalizeConfidenceTagSpacing(parsed.ipConcentration || ''),
        riskFactors: parsed.riskFactors || '',
        comparables: normalizeConfidenceTagSpacing(parsed.comparables || ''),
      }
    } else {
      return {
        positioningMap: normalizeConfidenceTagSpacing(parsed.positioningMap || ''),
        collaborationSignals: normalizeConfidenceTagSpacing(parsed.collaborationSignals || ''),
        methodologicalTrends: normalizeConfidenceTagSpacing(parsed.methodologicalTrends || ''),
        trlAssessment: '',
        commercialReadiness: '',
        ipConcentration: '',
        riskFactors: '',
        comparables: '',
      }
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate signals analysis:', error)
    return defaultSignals()
  }
}

function defaultSignals(): SignalsAnalysis {
  return {
    positioningMap: '',
    collaborationSignals: '',
    methodologicalTrends: '',
    trlAssessment: '',
    commercialReadiness: '',
    ipConcentration: '',
    riskFactors: '',
    comparables: '',
  }
}

/**
 * Enhance market context by integrating NIH funding data
 */
async function enhanceMarketContext(
  topic: string,
  rawContext: MarketContext,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<MarketContext> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  const topCategory = context.fundingStats.byCategory[0]?.category || 'research'
  const topOrgs = context.fundingStats.byOrg.slice(0, 5).map(o => o.org).join(', ')
  const yearTrend = formatYearTrendForPrompt(context.fundingStats.byYear.slice(0, 3))
  const partialDirective = partialFYPromptDirective(context.fundingStats)

  const prompt = `You are integrating market research with NIH funding data for "${topic}".${partialDirective}

## EXISTING MARKET OVERVIEW (from general knowledge)
${rawContext.overview}

## NIH FUNDING CONTEXT (from our analysis)
- Total NIH funding in sample: ${formatCurrency(context.fundingStats.total)}
- Projects analyzed: ${context.fundingStats.projectCount}
- Primary research category: ${formatCategory(topCategory)}
- Top funded organizations: ${topOrgs}
- Recent funding trend: ${yearTrend}

## TASK

Rewrite the market overview to INTEGRATE the NIH funding data. The new overview should:
1. Connect public funding patterns to commercial activity
2. Note if academic vs. industry focus is apparent
3. Identify any gaps between research activity and commercial development
4. Keep the best insights from the original overview

SAMPLE-BASED LANGUAGE: NIH data represents publicly-funded academic research. Use hedged integration:
- "NIH funding patterns suggest..." not "The market is..."
- "This public investment may indicate..." or "appears to correlate with..."
- Acknowledge NIH sample doesn't capture private/industry R&D

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

Return JSON only:
{
  "overview": "2-3 paragraphs integrating market + NIH funding insights"
}

Keep existing key players, market size, and recent developments unchanged.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6', // Use Sonnet for efficiency
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return rawContext
    }

    // Parse JSON
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return rawContext
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      ...rawContext,
      overview: parsed.overview || rawContext.overview,
      sources: [...rawContext.sources, 'NIH RePORTER funding analysis'],
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to enhance market context:', error)
    return rawContext
  }
}

/**
 * Generate curated publications with explanations
 */
async function generateCuratedPublications(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<CuratedPublication[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  if (agentOutputs.publications.items.length === 0) {
    return []
  }

  // Prepare publication details for curation
  const pubDetails = agentOutputs.publications.items
    .slice(0, 25)
    .map((p, i) => {
      const year = p.publication_date ? new Date(p.publication_date).getFullYear() : 'N/A'
      return `[${i + 1}] PMID: ${p.pmid}
Title: ${p.publication_title}
Journal: ${p.journal || 'N/A'} | Year: ${year}
Authors: ${p.authors || 'N/A'}
Abstract: ${p.abstract || 'No abstract available'}`
    })
    .join('\n\n---\n\n')

  const prompt = `From these ${agentOutputs.publications.items.length} publications linked to "${topic}" research:

${pubDetails}

---

Select the 3-5 MOST SIGNIFICANT publications for a ${persona === 'investor' ? 'life science investor' : 'researcher entering this field'}.

For each, explain WHY it matters. Consider:
- Foundational papers that define the field
- Methodological advances that enabled new research
- Recent breakthroughs with translational potential
- Reviews that provide comprehensive understanding

SAMPLE-BASED LANGUAGE: These are publications linked to NIH-funded projects in our sample. Use language like "among the linked publications" rather than claiming these are the definitive papers in the field.

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

Return JSON only (array of 3-5 items). Use the EXACT PMID strings from the
input above — do NOT invent PMIDs and do NOT reuse the same PMID twice.

CRITICAL ANTI-HALLUCINATION CHECK — include an "abstractQuote" field per
item. This must be a 6-15 word DIRECT VERBATIM QUOTE copied exactly from
THAT specific pmid's abstract above. The system will programmatically
verify the quote appears in the source abstract for the pmid you chose.
If your significance/keyFinding is describing a DIFFERENT paper than the
pmid you cited (a common failure mode), your abstractQuote will not
match the pmid's actual abstract and the entry will be dropped. Copy
the quote character-for-character from the abstract text shown above.

[
  {
    "pmid": "12345678",
    "significance": "1-2 sentences on why this paper matters for the field",
    "keyFinding": "One sentence key takeaway",
    "abstractQuote": "6-15 words copied verbatim from the abstract of this pmid"
  }
]

The title, journal, and year will be filled in by the system from the source
data, so omit them here.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // Bumped from 1500 to cover the added abstractQuote validation field.
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return []
    }

    // Parse JSON array from response. Strip ```json fences if present, then
    // regex-extract just the array. Matches the defensive pattern used by
    // every other JSON-output function in this file — without the regex
    // extraction, any prefix text from Claude ("Here are the picks:\n[...")
    // breaks parsing and silently empties the Key Publications section.
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/)
    if (!arrayMatch) {
      console.warn('[Synthesis Agent] No JSON array found in curated publications response')
      return []
    }

    const parsedRaw = JSON.parse(arrayMatch[0])
    if (!Array.isArray(parsedRaw)) return []

    // Hydrate title/journal/year from the source data — the model only
    // returns pmid + significance + keyFinding now. This eliminates two
    // historical failure modes:
    //   1. Two entries returned with the same PMID but different titles
    //      (LLM duplicating a pick under different framings).
    //   2. PMIDs the model hallucinated that don't exist in our input.
    // We also dedupe by pmid (first occurrence wins) so a same-PMID
    // duplicate from the model collapses to one entry instead of rendering
    // twice.
    const sourceByPmid = new Map<string, PublicationItem>()
    for (const p of agentOutputs.publications.items) {
      if (p.pmid) sourceByPmid.set(String(p.pmid), p)
    }

    const seen = new Set<string>()
    const hydrated: CuratedPublication[] = []
    for (const raw of parsedRaw) {
      if (!raw || typeof raw !== 'object') continue
      const pmid = raw.pmid ? String(raw.pmid) : ''
      if (!pmid || seen.has(pmid)) continue
      const source = sourceByPmid.get(pmid)
      if (!source) {
        console.warn(`[Synthesis Agent] Curated PMID ${pmid} not in input set — skipping`)
        continue
      }
      // Verify the LLM's description actually matches THIS pmid's paper.
      // Failure mode from Fable 5 audit: LLM cites pmid X (meningioma
      // review) but writes significance/keyFinding about paper Y (lung
      // cfDNA methylation). The abstractQuote is our verification —
      // it must appear verbatim in the source abstract. If it doesn't,
      // the LLM's description is describing a different paper and
      // shipping it would render a title/interpretation mismatch that
      // discredits the whole publications section. Prefer to drop the
      // entry silently than to ship a hallucinated match.
      const quote = typeof raw.abstractQuote === 'string' ? raw.abstractQuote.trim() : ''
      const abstract = (source.abstract || '').trim()
      if (!quote || !abstract) {
        console.warn(`[Synthesis Agent] Curated PMID ${pmid} missing quote or abstract — skipping`)
        continue
      }
      // Case-insensitive, whitespace-tolerant containment check. The
      // LLM sometimes normalizes spacing so we normalize both sides.
      const normalizeForMatch = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!normalizeForMatch(abstract).includes(normalizeForMatch(quote))) {
        console.warn(
          `[Synthesis Agent] Curated PMID ${pmid} abstractQuote NOT FOUND in source abstract — LLM likely described a different paper. Dropping.`,
        )
        console.warn(`  Quote: "${quote}"`)
        console.warn(`  Abstract prefix: "${abstract.slice(0, 200)}..."`)
        continue
      }
      seen.add(pmid)
      // Prefer pub_year (cleanly populated by the metadata fetcher's regex)
      // over deriving from publication_date — many rows have NULL date but
      // a valid year because PubMed's pubdate format ("Mar-Apr 2024",
      // "Spring 2024") doesn't parse to a date but the year regex still
      // succeeds. Falling back to publication_date and finally the LLM's
      // year guess keeps the path graceful.
      let year: number | null = source.pub_year ?? null
      if (year === null && source.publication_date) {
        const derived = new Date(source.publication_date).getFullYear()
        if (!isNaN(derived)) year = derived
      }
      if (year === null && typeof raw.year === 'number') year = raw.year
      hydrated.push({
        pmid,
        title: source.publication_title || raw.title || 'Untitled',
        journal: source.journal || null,
        year,
        significance: typeof raw.significance === 'string' ? raw.significance : '',
        keyFinding: typeof raw.keyFinding === 'string' ? raw.keyFinding : '',
      })
    }
    return hydrated
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate curated publications:', error)
    return []
  }
}

/**
 * Generate Field Maturity Assessment
 * Synthesizes preprint ratio, trial phases, and patent activity into TRL-style assessment
 */
async function generateFieldMaturityAssessment(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<FieldMaturityAssessment> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  // Calculate preprint ratio (estimate - publications from preprint servers)
  const totalPubs = agentOutputs.publications.items.length
  const preprintKeywords = ['biorxiv', 'medrxiv', 'arxiv', 'preprint', 'ssrn']
  const preprintCount = agentOutputs.publications.items.filter(p => {
    const journal = (p.journal || '').toLowerCase()
    return preprintKeywords.some(kw => journal.includes(kw))
  }).length
  const preprintRatio = totalPubs > 0 ? preprintCount / totalPubs : 0

  // Analyze trial phases
  const trialPhases = agentOutputs.trials.byPhase
  const hasLatePhase = (trialPhases['Phase 3'] || 0) > 0 || (trialPhases['Phase 4'] || 0) > 0
  const hasMidPhase = (trialPhases['Phase 2'] || 0) > 0
  const hasEarlyPhase = (trialPhases['Phase 1'] || 0) > 0 || (trialPhases['Early Phase 1'] || 0) > 0
  const totalTrials = agentOutputs.trials.items.length
  // Pre-computed counts the LLM must use verbatim — prevents the r28
  // pattern where the model said "59 trials categorized as N/A or
  // unknown phase" and only counted N/A (missing Unknown=1), so the
  // narrative arithmetic contradicted the phase table.
  const naCount = trialPhases['N/A'] || 0
  const unknownCount = trialPhases['Unknown'] || 0
  const naOrUnknownCount = naCount + unknownCount
  const phaseLabeledCount = totalTrials - naOrUnknownCount
  const observationalCount = agentOutputs.trials.items.filter(
    (t) => (t.study_type || '').toUpperCase() === 'OBSERVATIONAL',
  ).length
  const interventionalCount = agentOutputs.trials.items.filter(
    (t) => (t.study_type || '').toUpperCase() === 'INTERVENTIONAL',
  ).length
  // Interventional trials with an actual phase label. The pattern the
  // r28 audit flagged: byPhase count of Phase 1+2+3+4 doesn't equal the
  // interventional count, because some interventional trials are
  // unphased. Narrative that says "phase-labeled = interventional" is
  // wrong; we want "phase-labeled = the phased subset of interventional."
  const interventionalWithPhase = agentOutputs.trials.items.filter((t) => {
    if ((t.study_type || '').toUpperCase() !== 'INTERVENTIONAL') return false
    const p = (t.phase || '').toLowerCase()
    return p.includes('phase') && !p.includes('n/a') && !p.includes('unknown')
  }).length

  // Analyze patent recency
  const recentPatents = agentOutputs.patents.recentCount
  const totalPatents = agentOutputs.patents.items.length
  const patentRecencyRatio = totalPatents > 0 ? recentPatents / totalPatents : 0

  const persona = context.persona || 'researcher'
  const prompt = `Assess the FIELD MATURITY / TECHNOLOGY READINESS for "${topic}" based on these quantitative signals.

READER PERSONA: **${persona}** — tailor the strategicImplications field accordingly.


## PUBLICATION SIGNALS
- Total linked publications: ${totalPubs}
- Preprint ratio: ${(preprintRatio * 100).toFixed(0)}% (${preprintCount} preprints)
- Note: Higher preprint ratio suggests emerging field; established fields have more peer-reviewed pubs

## CLINICAL TRIAL SIGNALS
- Total trials: ${totalTrials}
- **CRITICAL: DENOMINATOR DISCIPLINE.** The only valid trial-count denominator is ${totalTrials}. Do NOT invent smaller denominators ("25 reviewed trials", "the reviewed subset", "18 relevant trials", "the interventional cohort of X") - if you didn't compute the subset from the data provided above, don't cite a subset count. Any "N trials" claim in your output must map to a count derivable from the exact numbers above (${totalTrials} total, ${interventionalCount} interventional, ${observationalCount} observational, ${phaseLabeledCount} phase-labeled, ${naOrUnknownCount} N/A+Unknown phase). Do NOT write "among the 25 reviewed trials" or any similar orphan-denominator framing.
- Phase distribution: ${JSON.stringify(trialPhases)}
- N/A phase (observational + others by design): ${naCount}
- Unknown phase (data missing): ${unknownCount}
- **Use verbatim if you cite it:** N/A + Unknown combined = ${naOrUnknownCount} trials.
- Phase-labeled trials (Phase 1-4 combined): ${phaseLabeledCount}
- Observational trials: ${observationalCount}. Interventional trials: ${interventionalCount}. Of the ${interventionalCount} interventional, only ${interventionalWithPhase} carry an actual phase label - the remaining ${Math.max(0, interventionalCount - interventionalWithPhase)} interventional trials are unphased.

**CRITICAL - PHASE-LABELED / INTERVENTIONAL FRAMING (BANNED CONSTRUCTIONS):**
Do NOT write ANY of these constructions in maturityNarrative, evidenceSummary, or strategicImplications:
- "${interventionalWithPhase} phase-labeled interventional trials" (collapses "phase-labeled" and "interventional" into 1:1 identity - implies interventional=${interventionalWithPhase} when it's ${interventionalCount})
- "the phase-labeled interventional trials" (same collapse)
- "${interventionalWithPhase} interventional trials with phase labels" (borderline - still confuses the counts)

REQUIRED framing when citing phase-labeled counts (use these VERBATIM):
- "${interventionalWithPhase} phase-labeled trials (the phased subset of ${interventionalCount} interventional)"
- OR: "the ${interventionalWithPhase} trials carrying an actual phase label - a subset of the ${interventionalCount} interventional trials in the sample"
- OR the two counts listed separately: "${interventionalCount} interventional trials, of which ${interventionalWithPhase} carry a phase label"

The point: any mention of phase-labeled counts MUST also acknowledge the ${interventionalCount} interventional total in the same sentence, so a reader cannot conflate the two.
- Has late-stage (Phase 3/4): ${hasLatePhase ? 'Yes' : 'No'}
- Has mid-stage (Phase 2): ${hasMidPhase ? 'Yes' : 'No'}
- Has early-stage (Phase 1): ${hasEarlyPhase ? 'Yes' : 'No'}

## PATENT SIGNALS
- Total patents: ${totalPatents}
- Recent (last 2 years): ${recentPatents}
- Recency ratio: ${(patentRecencyRatio * 100).toFixed(0)}%
- Note: High recent activity = accelerating; low recent = established or stalling

## RESEARCH CONTEXT
- NIH projects: ${context.fundingStats.projectCount}
- Total funding: $${(context.fundingStats.total / 1000000).toFixed(1)}M
- Top category: ${context.fundingStats.byCategory[0]?.category || 'research'}
- Funding by year: ${formatYearTrendForPrompt(context.fundingStats.byYear)}
${partialFYPromptDirective(context.fundingStats)}
---

Based on these signals, provide a Technology Readiness Level (TRL) assessment.

TRL Reference:
- TRL 1-2: Basic research, phenomena observed
- TRL 3-4: Proof of concept, lab validation
- TRL 5-6: Technology demonstration, prototype
- TRL 7-8: System complete, operational
- TRL 9: Full deployment/commercialization

SAMPLE-BASED LANGUAGE: These metrics come from NIH-linked data. Use confident but hedged language:
- "Based on the linked trials and patents, the technology appears to be at..."
- "The sample suggests TRL..." not "The technology is at TRL..."
- "This pattern may indicate..." or "suggests maturity level of..."

CRITICAL — STATISTICAL HONESTY: When a denominator is small, the percentage is not reliably interpretable. Apply these rules strictly:
- If totalPubs (${totalPubs}) is below 10, do NOT lean on the preprint ratio as a meaningful signal. State explicitly that "with only ${totalPubs} linked publications, the ${(preprintRatio * 100).toFixed(0)}% preprint ratio is not statistically interpretable" or similar honest phrasing. Discuss what is observable about journal mix instead.
- If totalPatents (${totalPatents}) is below 5, do NOT treat the recency ratio as a trend. Say "with only ${totalPatents} linked patents, recency ratios are not interpretable as trend signals" or similar.
- If totalTrials (${totalTrials}) is below 3, treat phase distribution as descriptive, not statistical.
- Never imply "the field has X" or "the field is doing Y" based on a small absolute count. Frame as "the linked sample contains X" or "no Y was observed in the sample."
- **TWO-POINT FUNDING TREND HEDGE — applies to strategicImplications especially.** If you cite two years of funding side-by-side (e.g. FY2024 vs FY2025), you MUST NOT describe the change as "a clear upward trajectory", "accelerating funding", "sustained growth", or any other trend language. Two data points do not establish a trend. Say "FY2024 to FY2025 rose from $Xm to $Ym in the sample, though two data points do not establish a trend" or similar. This rule holds for every field in this response, INCLUDING strategicImplications — a single hedge in the narrative doesn't license a dropped hedge in the strategic take.

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
Append this exact markdown pattern inline at the end of each field's content. Tagging rules:
- **maturityNarrative**: ONE tag at the very end of the entire field, not one per paragraph. The narrative describes a single TRL judgment — one tag suffices. Do NOT add a second tag mid-narrative just because you introduce a supporting fact; a supporting fact is not a separate claim.
- **evidenceSummary**: one tag per bulleted item (preprintRatio, trialProgression, patentActivity) — these are three distinct claims about three independent evidence streams.
- **strategicImplications**: ONE tag at the very end of the field.

Pattern:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts, e.g. "8 Phase 2 trials, 3 Phase 1, no Phase 3/4 across ${totalTrials} total linked trials"]

Confidence scale — apply these thresholds strictly:
- **High**: signal rests on ≥15 total items (pubs/trials/patents combined) AND is corroborated by at least two independent evidence streams (e.g., trial progression AND publication growth AND patent activity all agree).
- **Medium**: ≥5 items in one evidence stream, or moderate signals across two streams.
- **Low**: <5 items in the deciding stream. Explicitly state the sample size limitation.

For the trlEstimate itself: assign confidence based on whether ALL three signals (pubs, trials, patents) align on the same maturity band. Alignment = High. Disagreement or thin data = Medium/Low.

BENCHMARK COMPARISON (REQUIRED):
Provide a concrete historical reference point for the estimated TRL. Format: one sentence naming a comparable technology at a similar development stage in the past, and roughly when. Examples of the shape (do not copy verbatim — pick a reference relevant to THIS topic):
- "TRL 5-6 is comparable to where CRISPR-based gene editing was in 2015-2017, before broad clinical adoption but with mounting Phase 1/2 activity."
- "TRL 3-4 is roughly where mRNA vaccines sat in 2010, with strong lab validation but limited clinical demonstration."
The benchmark should be specific and defensible — a real historical parallel, not a vague comparison.

Return JSON only:
{
  "trlEstimate": "TRL X-Y" or narrative like "Early Research (TRL 1-3)",
  "maturityNarrative": "2-3 sentences with confidence+evidence tags explaining the overall maturity assessment and what it means for someone entering this space",
  "benchmarkComparison": "One sentence comparing this TRL to a specific historical technology at the same stage",
  "evidenceSummary": {
    "preprintRatio": "One sentence with confidence+evidence tag interpreting the preprint ratio — apply small-N rule above when totalPubs < 10",
    "trialProgression": "One sentence with confidence+evidence tag interpreting the trial phase distribution — apply small-N rule above when totalTrials < 3",
    "patentActivity": "One sentence with confidence+evidence tag interpreting the patent recency — apply small-N rule above when totalPatents < 5"
  },
  "strategicImplications": "2-3 sentences of persona-appropriate 'so what' advice. For a researcher persona, frame around proposal strategy (what grant mechanisms make sense, what collaborators to pursue, what analytical gaps to fill). For an investor persona, frame around investment thesis (what stage of company to look for, what technical milestones matter, what to diligence). Reference specific numbers from the data. MUST END WITH a Confidence+Evidence tag using the same '**Confidence: High/Medium/Low** - Evidence: [counts]' format required elsewhere — this is an interpretive claim about what the reader should do, so it must be tagged.",
  "overallAssessment": "nascent" | "emerging" | "maturing" | "established"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 1800 gives Field Maturity real room for confidence+evidence tags
      // on each of the 4 short fields, plus benchmarkComparison and
      // strategicImplications. Was 1500 which risked mid-JSON truncation
      // on a chatty response.
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return defaultFieldMaturity()
    }

    // Parse JSON from response
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return defaultFieldMaturity()
    }

    const parsed = JSON.parse(jsonMatch[0])
    return {
      trlEstimate: parsed.trlEstimate || 'Unknown',
      maturityNarrative: normalizeConfidenceTagSpacing(parsed.maturityNarrative || ''),
      benchmarkComparison: typeof parsed.benchmarkComparison === 'string' ? parsed.benchmarkComparison : undefined,
      evidenceSummary: {
        preprintRatio: normalizeConfidenceTagSpacing(parsed.evidenceSummary?.preprintRatio || ''),
        trialProgression: normalizeConfidenceTagSpacing(parsed.evidenceSummary?.trialProgression || ''),
        patentActivity: normalizeConfidenceTagSpacing(parsed.evidenceSummary?.patentActivity || ''),
      },
      strategicImplications:
        typeof parsed.strategicImplications === 'string'
          ? normalizeConfidenceTagSpacing(sanitizeText(parsed.strategicImplications, "strategicImplications"))
          : undefined,
      overallAssessment: parsed.overallAssessment || 'emerging',
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate field maturity assessment:', error)
    return defaultFieldMaturity()
  }
}

function defaultFieldMaturity(): FieldMaturityAssessment {
  return {
    trlEstimate: 'Unknown',
    maturityNarrative: 'Field maturity assessment not available.',
    evidenceSummary: {
      preprintRatio: '',
      trialProgression: '',
      patentActivity: '',
    },
    overallAssessment: 'emerging',
  }
}

/**
 * Generate Competitive Topology
 * Identifies methodological clusters: Approach | Players | Maturity
 */
async function generateCompetitiveTopology(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<CompetitiveTopology> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  // Prepare project abstracts for analysis
  const projectSummaries = agentOutputs.projects.items
    .slice(0, 30)
    .map((p, i) => {
      const tier = p.match_tier === 'precise' ? '[PRECISE]' : '[BALANCED]'
      return `[${i + 1}] ${tier} ${p.title}\nOrg: ${p.org_name || 'N/A'}\nAbstract: ${p.abstract || 'N/A'}`
    })
    .join('\n\n')

  // Prepare patent info for commercial angle
  const patentSummaries = agentOutputs.patents.items
    .slice(0, 15)
    .map((p) => `${p.patent_title} (${p.assignee || 'Unknown'})`)
    .join('\n')

  // Prepare trial info
  const trialSummaries = agentOutputs.trials.items
    .slice(0, 10)
    .map((t) => `${t.study_title} - ${t.lead_sponsor || 'N/A'} (${t.phase || 'Phase N/A'})`)
    .join('\n')

  const prompt = `Analyze the competitive topology for "${topic}" research.

READER PERSONA: **${persona}** — tailor the strategicImplications field accordingly.

Your task: Identify 3-5 DISTINCT METHODOLOGICAL APPROACHES or technology clusters, NOT organizational groupings.

## FULL PROJECT LIST (all ${agentOutputs.projects.items.length} projects — title + org + category, one per line)
${formatAllProjectsCompact(agentOutputs.projects.items)}

## PROJECT ABSTRACTS (top ${Math.min(30, agentOutputs.projects.items.length)} by funding)
${projectSummaries}

## PATENT LANDSCAPE
${patentSummaries || 'No patents identified'}

## CLINICAL DEVELOPMENT
${trialSummaries || 'No trials identified'}

## TOP ORGANIZATIONS BY FUNDING
${context.fundingStats.byOrg.slice(0, 10).map(o => `${o.org}: $${(o.funding/1000000).toFixed(1)}M`).join('\n')}

---

Identify methodological clusters. Each cluster should represent a TECHNICAL APPROACH, not an organization.

Examples of good clusters:
- "MEA-based electrophysiology" (technique)
- "iPSC-derived organoids" (platform)
- "Optogenetic stimulation" (method)
- "Computational modeling" (approach)

For each cluster, list:
1. The approach/methodology
2. Key players (mix of academic institutions AND companies if applicable)
3. Maturity level (Nascent/Emerging/Maturing/Mature)
4. Brief commercial readiness note

CRITICAL DATA-GROUNDING RULE for keyPlayers:
- Every organization named in keyPlayers MUST appear as an "Org" in the FULL PROJECT LIST above. Do not invent organizations or infer them from prior knowledge.
- The FULL PROJECT LIST is the authoritative universe of institutions in the analyzed sample. Scan it (not just the top-30 ABSTRACTS) when deciding which organizations belong to a given approach cluster — an institution can have projects below the top-30 by funding but still be a meaningful player in a methodological area.
- When you cite a company or non-NIH commercial player as a "key player", flag it explicitly (e.g., "(commercial, not in NIH sample)") so downstream rendering can distinguish sample-derived vs external claims.

SAMPLE-BASED LANGUAGE: This analysis covers NIH-funded academic research. Use hedged language:
- "Among the funded projects, distinct approaches include..."
- "Based on the sample, key academic players appear to be..."
- Commercial players may exist outside NIH-linked data; acknowledge this limitation

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
For each cluster's commercialReadiness AND for the top-level narrative, append this exact markdown pattern inline at the end of each substantive claim:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts, e.g. "18 projects across UCLA, Johns Hopkins, Stanford, with 4 companion patents"]

Confidence scale:
- **High**: cluster rests on ≥10 projects with multiple orgs and cross-source corroboration (linked patents or trials).
- **Medium**: 4-9 projects OR ≥10 projects concentrated at one org.
- **Low**: ≤3 projects OR forward-looking speculation.

STRATEGIC IMPLICATIONS (REQUIRED):
Produce a persona-appropriate strategicImplications paragraph tied to the cluster landscape.
- Researcher persona: which cluster is most competitive to enter vs. most differentiated? Which methodology should a new lab prioritize given the funded field, and what grant mechanisms (R01, R21, U01, SBIR) fit that positioning?
- Investor persona: which cluster is closest to commercial deployment vs. earliest-stage? Which cluster's IP/trial signals suggest first-mover risk vs. exit optionality? What technical or clinical milestones would validate a bet in each cluster?

Reference specific cluster names and their counts from the data. 3-4 sentences, concrete and actionable.

**CRITICAL: NO INSTITUTIONS-AS-ENTRY-POINTS.** In strategicImplications, do NOT name specific institutions as "entry points", "targets", "represent differentiated entry points", or attach institutional labels to methodology recommendations. Institution names are FINE inside the clusters[].keyPlayers list (that's factual data) and FINE when the cluster narrative describes concentration ("cfDNA methylation concentrates at UCLA, Johns Hopkins, Stanford"). Institution names are NOT FINE in the strategicImplications field even softened as "primarily UIUC and UConn" attached to a differentiation-target framing. That construction directs the reader toward those institutions. Rewrite: "The CRISPR-based amplification cluster (approximately 5 projects) is a differentiated entry point given its smaller footprint and technical distinctness" - NO institution names in the strategicImplications recommendation. Institution names in that field = fail.

**ADJACENCY RULE.** The strategicImplications field renders IMMEDIATELY BELOW the cluster listing (which shows Key Players by name). If your strategicImplications references "the most differentiated positioning for a new lab" or "the highest-competition cluster to enter", a reader sees the named-institution list right above and connects your recommendation to those specific institutions. Even without naming them in strategicImplications, that adjacency reads as prescriptive targeting. Fix: refer to APPROACHES not "clusters" in your recommendations. WRONG: "The most differentiated positioning for a new lab is in [cluster reference]." RIGHT: "Differentiation opportunities favor CRISPR-based point-of-care biosensors or nanoplasmonic single-molecule detection, both of which have thinner NIH-linked activity than cfDNA methylation." The reader gets the direction (methodology) without any implicit institution targeting.

Return JSON only:
{
  "clusters": [
    {
      "approach": "Name of the methodological approach",
      "keyPlayers": ["Stanford", "MIT", "Company X"],
      "maturityLevel": "Emerging",
      "commercialReadiness": "One sentence with confidence+evidence tag on commercialization status"
    }
  ],
  "narrative": "2-3 sentences with confidence+evidence tags synthesizing the competitive topology - what are the main competing approaches and how do they relate?",
  "strategicImplications": "3-4 sentences of persona-appropriate 'so what' advice tied to the cluster landscape. MUST END WITH a Confidence+Evidence tag using the same '**Confidence: High/Medium/Low** - Evidence: [counts]' format required elsewhere in the report."
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 3500 for 5 clusters with confidence+evidence tags + narrative
      // + strategicImplications. r21 tried 2500 and the JSON truncated
      // mid-array, throwing JSON.parse and dropping the entire section
      // to the empty-fallback default. Extra headroom prevents that.
      max_tokens: 3500,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return defaultCompetitiveTopology()
    }

    // Parse JSON from response
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return defaultCompetitiveTopology()
    }

    // Best-effort parse with graceful degradation. If the JSON is
    // truncated mid-array (LLM hit max_tokens), pull out whatever
    // clusters we can salvage rather than dropping the entire section.
    let parsed: {
      clusters?: unknown
      narrative?: unknown
      strategicImplications?: unknown
    } = {}
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.warn('[Synthesis Agent] Competitive topology JSON parse failed, attempting salvage:', parseErr)
      // Try to salvage: extract clusters array manually
      const clustersMatch = jsonText.match(/"clusters"\s*:\s*(\[[\s\S]*?\])(?=\s*,\s*"|\s*})/)
      if (clustersMatch) {
        try {
          parsed.clusters = JSON.parse(clustersMatch[1])
        } catch {
          /* clusters unsalvageable */
        }
      }
      const narrativeMatch = jsonText.match(/"narrative"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (narrativeMatch) parsed.narrative = narrativeMatch[1]
      const stratMatch = jsonText.match(/"strategicImplications"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (stratMatch) parsed.strategicImplications = stratMatch[1]
    }
    // Normalize confidence-tag spacing on both cluster.commercialReadiness
    // (each cluster carries its own confidence tag) and the top-level
    // narrative. r25 audit caught a "viableConfidence:" concatenation
    // bug in the Competitive Positioning cluster row.
    type Cluster = { commercialReadiness?: string; [k: string]: unknown }
    const rawClusters: Cluster[] = Array.isArray(parsed.clusters)
      ? (parsed.clusters as Cluster[])
      : []
    const clusters = rawClusters.map((c) => ({
      ...c,
      commercialReadiness:
        typeof c.commercialReadiness === 'string'
          ? normalizeConfidenceTagSpacing(c.commercialReadiness)
          : '',
    }))
    return {
      clusters: clusters as never[],
      narrative: typeof parsed.narrative === 'string' ? normalizeConfidenceTagSpacing(parsed.narrative) : '',
      strategicImplications:
        typeof parsed.strategicImplications === 'string'
          ? normalizeConfidenceTagSpacing(sanitizeText(parsed.strategicImplications, "strategicImplications"))
          : undefined,
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate competitive topology:', error)
    return defaultCompetitiveTopology()
  }
}

function defaultCompetitiveTopology(): CompetitiveTopology {
  return {
    clusters: [],
    narrative: 'Competitive topology analysis not available.',
  }
}

/**
 * Generate IP Landscape Assessment
 * Analyzes patent concentration and freedom-to-operate signals
 */
async function generateIPLandscapeAssessment(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<IPLandscapeAssessment> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  const totalPatents = agentOutputs.patents.items.length
  const recentPatents = agentOutputs.patents.recentCount
  const topAssignees = agentOutputs.patents.byAssignee.slice(0, 10)

  // Calculate concentration metrics
  const topAssigneeCount = topAssignees.length > 0 ? topAssignees[0].count : 0
  const concentrationRatio = totalPatents > 0 ? topAssigneeCount / totalPatents : 0

  // Determine if academic or commercial dominant
  const academicKeywords = ['university', 'institute', 'college', 'research', 'foundation', 'hospital']
  const academicPatents = agentOutputs.patents.items.filter(p => {
    const assignee = (p.assignee || '').toLowerCase()
    return academicKeywords.some(kw => assignee.includes(kw))
  }).length
  const academicRatio = totalPatents > 0 ? academicPatents / totalPatents : 0

  // Prepare patent details for analysis
  const patentDetails = agentOutputs.patents.items
    .slice(0, 20)
    .map((p) => `${p.patent_title} | ${p.assignee || 'Unknown'} | ${p.patent_date || 'N/A'}`)
    .join('\n')

  if (totalPatents === 0) {
    return {
      concentration: 'fragmented',
      dominantAssignees: [],
      freedomToOperate: 'No patents identified in this space, suggesting either early-stage research or limited commercial interest.',
      recentActivityTrend: 'No patent activity observed',
      narrative: 'The absence of patents may indicate this is an emerging research area without commercial protection yet, or the technology may be published openly.',
    }
  }

  const IP_LABEL_MIN_N = 10
  const insufficientSample = totalPatents < IP_LABEL_MIN_N
  const insufficientSampleRule = insufficientSample
    ? `\n**INSUFFICIENT-SAMPLE MODE - ${totalPatents} linked patents (below ${IP_LABEL_MIN_N} threshold).** In this mode you MUST NOT use ANY of these words, phrases, or construction patterns anywhere in narrative, freedomToOperate, or strategicImplications:
- Shape words: "fragmented", "concentrated", "moderately concentrated", "highly concentrated", "consolidated", "converged", "converging", "cluster", "clusters", "clustered", "clustering", "cluster around"
- Distribution phrases: "distributed across", "spread across", "held across ... rather than", "diverse but institutionally", "diverse but", "diverse landscape", "wide range of"
- Breadth/multiplicity phrases: "breadth of methods", "breadth of approaches", "multiple independent patent families", "multiple independent technical approaches", "multiple approaches rather than", "pursued across multiple", "across multiple ... approaches", "no single [dominant/preferred] method"
- **PERCENTAGES on the ${totalPatents}-patent base.** DO NOT report distribution as percentages: no "63% academic", no "25% held by top assignee", no "60% of assignees are universities". A percentage on N=${totalPatents} is not a meaningful distribution claim - "5 of 8 are academic" is a raw count; "63% academic" implies a distribution shape the sample can't support. Cite raw counts only ("6 of ${totalPatents} assignee-on-record patents are academic"), never percentages.
- Any construction that INFERS a distribution SHAPE, BREADTH, CONVERGENCE state, or CLUSTERING pattern (fragmented vs consolidated is a spectrum; any point on that spectrum is off-limits when the sample can't support the read). Saying "the patents span multiple technical areas rather than converging on one method" is a shape claim about breadth, banned. Saying "these ${totalPatents} patents include methylation, EV proteomics, CRISPR, and CTC methods" is a factual list of what's in the sample, allowed. Saying "the innovations cluster around nucleic acid detection" is a shape claim ("cluster around"), banned.

The Patent section header will show "Insufficient sample to characterize"; any distribution/breadth/convergence/clustering claim directly contradicts that. Instead describe what the sample contains as literal descriptors of THIS SAMPLE ("the ${totalPatents} linked patents span N assignees across the following technical areas: ..."), NOT as a claim about how the field is organized.

Strategic implications must frame IP-related actions as "run a full USPTO/Google Patents/PATENTSCOPE search" - never as "align with the [shape] IP base" or "clear multiple independent families."\n`
    : ''

  const prompt = `Analyze the IP landscape for "${topic}" based on patent data.

READER PERSONA: **${persona}** - tailor the strategicImplications field accordingly.
${insufficientSampleRule}
## PATENT STATISTICS
- Total patents: ${totalPatents}
- Recent (last 2 years): ${recentPatents}
- Top assignee holds: ${topAssigneeCount} patents (${(concentrationRatio * 100).toFixed(0)}% of total)
- Academic vs commercial: ${(academicRatio * 100).toFixed(0)}% appear academic

## TOP ASSIGNEES
${topAssignees.map((a, i) => `${i + 1}. ${a.assignee}: ${a.count} patents`).join('\n')}

## PATENT SAMPLE
${patentDetails}

---

Assess the IP landscape. Consider:
1. Concentration: Is IP fragmented across many players or concentrated with few?
2. Dominant players: Who controls the key patents?
3. Freedom to operate: What are FTO concerns for a new entrant?
4. Recent activity: Is patenting accelerating or declining?

SAMPLE-BASED LANGUAGE: CRITICAL - These are only patents linked to NIH projects, NOT the complete IP landscape. Commercial patents (e.g., from Axion, MaxWell) may not appear. Use appropriately hedged language:
- "Among the NIH-linked patents..." not "The IP landscape is..."
- "This concentration pattern suggests..." not "Stanford controls the space"
- "Based on linked patents, FTO concerns may include..." not definitive FTO claims
- "The sample indicates..." or "appears to show..." not absolute statements
- Explicitly note that commercial/international patents may exist outside this sample

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
Append this exact markdown pattern inline at the end of each substantive claim in freedomToOperate, recentActivityTrend, and narrative:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts, e.g. "10 patents from 4 assignees, 0 in the last 2 years"]

Confidence scale:
- **High**: pattern rests on ≥15 linked patents across multiple assignees.
- **Medium**: 5-14 linked patents OR clear concentration among 2-3 assignees.
- **Low**: <5 linked patents. Explicitly state that with a small linked sample, the true commercial IP landscape is likely much larger.

STRATEGIC IMPLICATIONS (REQUIRED):
Add a persona-appropriate "so what" paragraph tied to the IP finding. Reader persona is provided at top of prompt. Reference specific counts.

**ENUMERATION-COUNT MATCH.** If you write "N distinct [technical areas / clusters / categories / assignees]" and then enumerate them, N must equal the count of items you enumerate. Do NOT write "four distinct technical areas" followed by five items. Before finalizing, count the items you list and update N to match, or drop the count entirely and let the enumeration speak for itself.

DESCRIPTIVE vs PRESCRIPTIVE (critical rule):
- Naming assignee institutions when describing IP concentration is FINE ("2 patents at Johns Hopkins, 2 at UConn — no single institution dominates").
- Naming assignee institutions when prescribing action toward them is NOT FINE ("align with the Johns Hopkins node for licensing", "engage with UConn for sponsored research", "collaborators at Cornell would be receptive"). Rewrite as pattern-level observations: "the presence of distinct technical clusters at a handful of academic assignees suggests foundational IP is accessible through standard academic licensing channels" — not a directive to approach any specific assignee.
- Never name individual PIs in the IP narrative fields. Patent inventors as a list are fine only when the reader is looking at the Key Patents table; in the strategicImplications field, keep it at the pattern level.

Return JSON only. Do NOT include a list of patent holders — the system
fills that in from the actual byAssignee counts. Only return the
narrative fields below.
{
  "concentration": "fragmented" | "moderately_concentrated" | "highly_concentrated",
  "freedomToOperate": "2-3 sentences with confidence+evidence tags assessing potential FTO concerns based on the NIH-linked sample",
  "recentActivityTrend": "One sentence with confidence+evidence tag on patent activity trend within the linked sample",
  "narrative": "2-3 sentences with confidence+evidence tags on what the linked patent pattern may suggest for commercial development",
  "strategicImplications": "2-3 sentences of persona-appropriate 'so what' advice tied to the IP concentration and activity pattern. MUST END WITH a Confidence+Evidence tag using the same '**Confidence: High/Medium/Low** - Evidence: [counts]' format required elsewhere. Given IP samples are typically small (NIH-linked patents only), confidence will usually be Medium or Low — say so explicitly."
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 1800 gives IP Landscape's four narrative fields + strategic
      // implications real headroom for confidence+evidence tags.
      // Was 1500 which risked mid-JSON truncation.
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return defaultIPLandscape()
    }

    // Parse JSON from response
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return defaultIPLandscape()
    }

    const parsed = JSON.parse(jsonMatch[0])
    // dominantAssignees is sourced from the actual patent assignee counts,
    // NOT from the LLM. The LLM produces interpretation; the data is the
    // source of truth for who holds the patents.
    //
    // Force concentration to 'insufficient_sample' when the linked patent
    // count is below the label-eligibility threshold (renderIPLandscape
    // uses the same threshold). Without this, the Patent section refuses
    // to characterize concentration but downstream consumers (Next Steps
    // prompt) still see 'moderately_concentrated' from the LLM and echo
    // it back — a direct self-contradiction Fable's r28 audit caught.
    const IP_LABEL_MIN_N = 10
    const concentrationLabel =
      totalPatents < IP_LABEL_MIN_N
        ? ('insufficient_sample' as const)
        : parsed.concentration || 'fragmented'
    return {
      concentration: concentrationLabel,
      dominantAssignees: topAssignees.slice(0, 5).map((a) => a.assignee),
      freedomToOperate: normalizeConfidenceTagSpacing(parsed.freedomToOperate || ''),
      recentActivityTrend: normalizeConfidenceTagSpacing(parsed.recentActivityTrend || ''),
      narrative: normalizeConfidenceTagSpacing(parsed.narrative || ''),
      strategicImplications:
        typeof parsed.strategicImplications === 'string'
          ? normalizeConfidenceTagSpacing(sanitizeText(parsed.strategicImplications, "strategicImplications"))
          : undefined,
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate IP landscape assessment:', error)
    return defaultIPLandscape()
  }
}

function defaultIPLandscape(): IPLandscapeAssessment {
  return {
    concentration: 'fragmented',
    dominantAssignees: [],
    freedomToOperate: 'IP landscape assessment not available.',
    recentActivityTrend: '',
    narrative: '',
  }
}

/**
 * Generate insights for each top project relative to the overall report narrative
 */
async function generateProjectInsights(
  topic: string,
  projects: ProjectItem[],
  executiveSummary: string,
  context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<Record<string, string>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  // Only generate insights for top 10 projects
  const topProjects = projects.slice(0, 10)
  if (topProjects.length === 0) {
    return {}
  }

  const projectDetails = topProjects
    .map((p, i) => {
      const cleanedAbstract = cleanNarrative(p.abstract) || 'No abstract available'
      return `[${i + 1}] ID: ${p.application_id}
Title: ${p.title}
PI: ${p.pi_names?.split(';')[0]?.trim() || 'N/A'}
Organization: ${p.org_name || 'N/A'}
Category: ${p.primary_category || 'N/A'}
Funding: ${formatCurrency(p.total_cost || 0)}
Abstract: ${cleanedAbstract}`
    })
    .join('\n\n---\n\n')

  const prompt = `You are analyzing NIH-funded research projects for a report on "${topic}".

## REPORT CONTEXT (Executive Summary)
${executiveSummary}

## TOP PROJECTS TO ANALYZE
${projectDetails}

---

For each project, generate a 2-3 sentence insight explaining:
1. How this project contributes to or advances the field of "${topic}"
2. What makes this project noteworthy (unique approach, strategic positioning, or connection to broader trends)

Be specific and analytical. Reference the project's actual methods or focus when possible.

**NO PI-POSSESSIVE PHRASES.** Do NOT write "Zhou's DELFI work", "Velculescu's approach", "Wang's platform", "Chen's group", or any "[PI Surname]'s [X]" construction. The PI field is displayed as structured metadata in the project card; the insight text must not reference the PI by name at all - not even as a possessive. WRONG: "Velculescu's DELFI work is among the more established fragmentomics programs." RIGHT: "the DELFI work here is among the more established fragmentomics programs" (or drop the reference entirely and describe the method). Same rule applies to first-name possessives ("David's assay") and to team labels ("the Zhou lab").

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.
BANNED FIELD-LEVEL ABSOLUTES: Do not use "clear gap", "clear methodological gap", "clear point-of-care gap", "clear [any word] gap", "a clear gap exists", "structural underfunding", "structurally underfunded", "will pressure/force/drive/require/shift/increase/accelerate" (any bare future-tense absolute), or the sample-share-to-structural inference pattern where a low sample percentage is used to claim "limited investigation into X relative to translational volume" / "limited mechanistic work" / "underfunded relative to Y" (that turns a share into a field-level judgment), or the softer "N% suggesting X is thin in this sample" pattern (a share paired with "thin", "sparse", "scarce", "meager", "underrepresented" alongside "suggesting" or "indicating" reads as a field-level judgment - the "in this sample" scope word does NOT rescue it), or the sample-gap-may-constrain pattern where a sample-observed gap is cited as a cause of field-level limitations ("that mechanistic gap may constrain sensitivity improvements", "this discovery gap may limit specificity gains" - the "may" hedge does not fix this; the sample cannot support causal claims about what constrains the field). Rewrite as "within the analyzed sample, X is sparse" or "is likely to Y" or "represents a low share of sample projects; whether this reflects true underfunding or NIH-linked scope is not resolvable here".
BANNED AI-TELL PHRASES: Do not use "inflection point", "step-change", "poised to", "underscores", "landscape reveals", "perhaps most critically", or the "genuine [noun]" pattern (any construction where "genuine" modifies a claim-noun — e.g. "genuine opportunity", "genuine gap", "genuine bottleneck", "genuine differentiation", "genuine methodological opportunity"). Drop the modifier and say what the thing IS. Say what the thing IS, not that it is "genuine".

Return JSON only (object mapping application_id to insight string):
{
  "application_id_1": "2-3 sentence insight for project 1",
  "application_id_2": "2-3 sentence insight for project 2",
  ...
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 90_000,
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return {}
    }

    // Parse JSON from response
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return {}
    }

    const parsed = JSON.parse(jsonMatch[0])
    // Validate that every key in the LLM's response is an actual
    // application_id from the input set. Hallucinated keys would silently
    // never match a project on render, but filtering keeps the contract
    // clean — only real application_ids survive.
    const validIds = new Set(topProjects.map((p) => String(p.application_id)))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (validIds.has(k) && typeof v === 'string') out[k] = v
    }
    return out
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate project insights:', error)
    return {}
  }
}

/**
 * Generate a persona-specific "Next Steps" checklist. Concrete, actionable
 * items tied to the specific data in this report — not generic advice.
 * Runs late in the synthesis so it can reference the full picture
 * (white space top opportunities, IP concentration, funding trend).
 */
async function generateNextSteps(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  whiteSpace: WhiteSpaceAnalysis,
  ipLandscape: IPLandscapeAssessment,
  usageTracker: UsageTracker,
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const persona = context.persona || 'researcher'

  // Aggregate patterns from top orgs/PIs — no names passed to the LLM.
  // The Next Steps checklist should point to patterns and mechanisms, not
  // "reach out to Dr. X" or "target Org Y." Names live in the Key
  // Organizations and Key Researchers tables where readers can look up
  // specifics themselves. See callout audit 2026-07-10.
  //
  // IMPORTANT: use fundingStats.orgCount (total funded orgs in sample),
  // NOT topOrganizations.length (a top-N slice for the table). Passing
  // the top-N as if it were the total produced "$100.9M distributed
  // across 15 organizations" in r28 when the real total was 65 — Fable
  // audit flagged the wrong denominator.
  const totalOrgCount = context.fundingStats.orgCount
  const topFundedPIProjectCount = context.topResearchers
    .slice(0, 5)
    .reduce((sum, r) => sum + r.projects, 0)
  const topOpps = whiteSpace.topOpportunities
    .slice(0, 4)
    .map((o) => `${o.categoryName} (${o.dimensionName}, sample=${o.sampleCount}, broader NIH=${o.broaderNihCount})`)
    .join('; ')

  // IP concentration guidance — differs when the sample can support a
  // label vs. when it can't. Keeping the prompt honest about which
  // regime we're in prevents Next Steps from asserting a concentration
  // read that the Patent section explicitly declined to make.
  const ipConcentrationGuidance =
    ipLandscape.concentration === 'insufficient_sample'
      ? `IP concentration: CANNOT BE CHARACTERIZED — only ${agentOutputs.patents.items.length} linked patents in sample (label requires >=10). Do NOT assert a concentration read in the checklist; frame any IP action as "run a full USPTO/Google Patents/PATENTSCOPE search — the linked-patent sample is too small to characterize the landscape."`
      : `IP concentration: ${ipLandscape.concentration}`

  const prompt = `Write a persona-specific "Next Steps" checklist for a report on "${topic}".

READER PERSONA: **${persona}**

Reference the report's ACTUAL findings (don't produce generic advice):
- Analyzed sample: ${agentOutputs.projects.items.length} projects across ${totalOrgCount} funded organizations
- Top 5 PIs combined hold ${topFundedPIProjectCount} projects (see Key Researchers table for specific names)
- Top white-space signals: ${topOpps || 'none'}
- Total NIH funding: ${formatCurrency(context.fundingStats.total)}
- Total trials in sample (post relevance filter): ${agentOutputs.trials.items.length}
- Total patents in sample (post relevance filter): ${agentOutputs.patents.items.length}
- ${ipConcentrationGuidance}

Produce a checklist of 6-8 concrete NEXT ACTIONS the reader should take AFTER reading this report. Each item should:
- Be specific to a technology category, methodology, funding pattern, grant mechanism, gap signal, or research question surfaced in the data
- Point to a concrete action (search, read, review, apply for, verify, benchmark against)
- Reference where the reader should look (which NIH program, which section of THIS report — e.g. "see the Key Organizations table", "see the Coverage Gap Signals section")

**CRITICAL — NO NAMED ACTORS AS TARGETS AND NO PRESCRIPTIVE TARGETING OF SETS.** This checklist is read by the same community it describes. Do NOT:
- Name any principal investigator (PI) by name. Individual PIs are in the Key Researchers table; do not tell the reader to "examine Zhou's portfolio" or "assess Wong's work" — say "review the top-funded PIs (see Key Researchers table)" instead.
- **Use "their"/"them" as a possessive/pronoun referring back to a group of researchers.** Even after pointing the reader to "the Key Researchers table", do NOT write "read their funded abstracts", "review their publications", "study their approaches", or "benchmark against their trajectory". Downstream possessive references treat the researcher set as an action target - same Dimension 5 fail as naming a PI. Rewrite to point at the ARTIFACT not the people: "read the funded abstracts and publications in your methodological category" or "review projects in the [approach] cluster (see Key Research Projects table)".
- Name any institution as a target for outreach, collaboration, licensing, or benchmarking. Do NOT write "use Johns Hopkins as a target", "scout collaborators at MGH", "engage with UCLA researchers".
- **Also do NOT use "prescriptive targeting" verbs on the community as a group, even when no specific institution is named.** BANNED phrasings: "scout collaborator institutions", "scout collaborators", "identify potential (collaboration|consortium) partners", "identify (natural|potential) partners", "natural co-investigator (partners|candidates)", "natural consortium partners", "consortium partners", "reach out to institutions active in X", "engage with the leading nodes in Y". These read as telling the researcher to hunt for partners in the profiled community. Rewrite as self-directed research: "run a RePORTER search by analyte/cancer type to map the collaboration landscape yourself" or "review the Key Organizations table to see which institutions are active in [category]" (descriptive, not prescriptive).
- **BANNED "hub" / "entry point" / "access node" framing near a named institution.** Do NOT write "MGH functions as a hub", "X is a methodologically diverse hub", "Y is a collaboration entry point", "Z serves as an access node", or any infrastructure/collaboration verb ("resource node", "gateway", "on-ramp", "portal") next to an institution name. Naming an org that way tells the reader that org is a good target to approach - same prescriptive read as "reach out to". Rewrite as raw factual concentration ("MGH holds 10 projects across 5 methodological categories") without the hub/entry-point/access-node modifier. Applies whether the institution is named directly or referred to by a short-form (MGH, JH, UCSF, etc).
- Name specific companies as targets. Companies in the Market Context section are for market awareness; they are not action targets in this checklist.

Persona guidance:
- **researcher**: proposal strategy, collaborator scouting patterns, methodology gaps to close, grant mechanisms to target (R01, R21, U01, SBIR). Frame collaborator scouting as "search the Key Organizations table for institutions active in [approach]", not "reach out to Institution X."
- **investor**: diligence questions, categories of companies to research, technical milestones to watch, market signals to monitor. Frame diligence as "map the commercial landscape for [approach]", not "look at Company X."

DATA-INTEGRITY CAVEATS — bake these into item wording, not as a footer:
- **White-space "gaps" are candidate hypotheses, not verified opportunities.** Broader-NIH ratios are directional at low topic-sample counts. Before an item recommends "target the X gap for an SBIR", frame it as "investigate whether X is a real gap or a taxonomy artifact — check whether adjacent NIH portfolios (metabolomics, systems biology, etc.) already cover this work under different terminology, then draft a proposal only if the gap holds up."
- **NIH-ack-gating.** Trial/patent counts in this report only reflect items acknowledging an NIH grant. Do NOT recommend "in-license from Org X because they have no filed IP" — commercial patents and international filings are structurally invisible. Frame IP-related actions as "search USPTO + Google Patents + PATENTSCOPE for full assignee landscape, don't rely on the NIH-linked patent count alone."
- **Do NOT recommend actions that assume the broader-NIH counts are precise.** Use phrases like "explore whether the underrepresentation of X reflects real whitespace" rather than "capitalize on the X gap."

FORMATTING: Return raw markdown (NOT wrapped in JSON). Each item as a checkbox line: "- [ ] Item text here"
Do NOT use em dashes (—). Use regular hyphens (-) or rewrite.
Start directly with the first "- [ ]" — no preamble, no section heading.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // 6-8 checkbox items × ~50 tokens each = ~500 tokens. 1200 is
      // plenty with headroom.
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }, {
      timeout: 60_000,
    })
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const text = response.content.find((c) => c.type === 'text')
    if (!text || text.type !== 'text') return ''
    let raw = text.text.trim()
    if (raw.startsWith('```')) {
      raw = raw.replace(/```(?:markdown)?\n?/g, '').replace(/```$/g, '').trim()
    }
    // Only keep checkbox lines and empty lines — LLM sometimes prepends a heading
    // despite the instruction. Filter to safe output.
    const lines = raw.split('\n').filter((l) => {
      const t = l.trim()
      return t.startsWith('- [ ]') || t.startsWith('- [x]') || t === ''
    })
    return lines.join('\n').trim()
  } catch (err) {
    console.warn('[Synthesis Agent] Failed to generate Next Steps:', err)
    return ''
  }
}

/**
 * Determine contextual section title based on topic category
 */
function getClinicalSectionTitle(topCategory: string, trialCount: number): string | null {
  if (trialCount === 0) return null
  if (topCategory === 'biotools') return 'Research Tool Applications'
  if (topCategory === 'therapeutics') return 'Clinical Development Pipeline'
  if (topCategory === 'diagnostics') return 'Clinical Validation Status'
  if (topCategory === 'medical_device') return 'Device Development Pipeline'
  return 'Clinical & Translational Activity'
}

/**
 * Assemble the full markdown report
 */
function assembleMarkdown(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  executiveSummary: string,
  insights: SectionInsights,
  signalsAnalysis: SignalsAnalysis,
  curatedPublications: CuratedPublication[],
  fieldMaturity: FieldMaturityAssessment,
  competitiveTopology: CompetitiveTopology,
  ipLandscape: IPLandscapeAssessment,
  projectInsights?: Record<string, string>,
  whiteSpace?: WhiteSpaceAnalysis,
  surprisingFindings?: SurprisingFinding[],
  nextSteps?: string
): string {
  const persona = context.persona || 'researcher'
  // Use the report's created_at date (passed in via context) so this
  // "Generated:" line matches the UI/PDF header. Falls back to now if
  // not provided (portfolio reports don't yet plumb it through).
  const generatedDate = context.generatedAt ? new Date(context.generatedAt) : new Date()
  const now = generatedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  const topCategory = context.fundingStats.byCategory[0]?.category || 'research'
  const clinicalSectionTitle = getClinicalSectionTitle(topCategory, agentOutputs.trials.items.length)

  // Header - persona-aware title (with title case)
  const titleCaseTopic = topic
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
  const reportTitle = persona === 'investor'
    ? `${titleCaseTopic} Investment Intelligence`
    : `${titleCaseTopic} Research Landscape`

  let md = `# ${reportTitle}

**Generated:** ${now}
**Report Type:** ${persona === 'investor' ? 'Investment Intelligence' : 'Research Intelligence'}
**Data Sources:** NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed
${context.dataLimited ? '\n**Note:** This report has limited data available for this topic.\n' : ''}

---

## How to Use This Report

${renderHowToUse(persona)}

---

## What This Report Does Not Cover

${renderBlindSpots(persona)}

---

## Executive Summary

${executiveSummary}

---

${surprisingFindings && surprisingFindings.length > 0 ? `## What Surprised Us

*Non-obvious findings detected algorithmically from the data, then interpreted. These are **flagged hypotheses**, not verified conclusions - patterns worth investigating rather than facts to act on directly. Broader NIH ratios are directional at low topic-sample counts and could reflect real gaps OR taxonomy artifacts; treat individual findings as starting points for deeper diligence.*

${renderSurprisingFindings(surprisingFindings)}

---

` : ''}## Field Maturity Assessment

${renderFieldMaturity(fieldMaturity)}

---

## Competitive Topology

${renderCompetitiveTopology(competitiveTopology)}

---

${whiteSpace && whiteSpace.dimensions.length > 0 ? `## White Space Analysis

${renderWhiteSpace(whiteSpace)}

---

` : ''}`

  // PERSONA-SPECIFIC SECTIONS
  if (persona === 'investor') {
    // INVESTOR REPORT STRUCTURE
    md += `## Investment Signals

${renderInvestorSignals(signalsAnalysis)}

---

## Market Context

${renderMarketContext(agentOutputs.market.context)}

---

## IP Landscape

${renderIPLandscape(ipLandscape, agentOutputs.patents, insights.patents)}

---

## NIH Funding Analysis

${renderFundingLandscape(context.fundingStats, insights.funding)}

---

## Key Research Projects

${renderProjects(topFundedProjects(agentOutputs.projects.items, 10), projectInsights)}

---

`
    // Clinical section with dynamic title (only if there are trials)
    if (clinicalSectionTitle) {
      md += `## ${clinicalSectionTitle}

${renderClinicalPipeline(agentOutputs.trials, insights.clinicalPipeline)}

---

`
    }

    md += `## Key Organizations

${renderOrganizations(context.topOrganizations, context.fundingStats.orgCount)}

---

## Key Researchers

*Investors often need names for diligence, partnership, and recruiting conversations. The PIs below are ranked by NIH funding within the analyzed sample.*

${renderResearchers(context.topResearchers)}

---

## Key Publications

${renderCuratedPublications(curatedPublications, agentOutputs.publications, insights.publications)}

---

`
  } else {
    // RESEARCHER REPORT STRUCTURE
    md += `## Research Positioning

${renderResearcherSignals(signalsAnalysis)}

---

## NIH Funding Landscape

${renderFundingLandscape(context.fundingStats, insights.funding)}

---

## Key Research Projects

${renderProjects(topFundedProjects(agentOutputs.projects.items, 10), projectInsights)}

---

## Market Context

${renderMarketContext(agentOutputs.market.context)}

---

`
    // Clinical section with dynamic title (only if there are trials)
    if (clinicalSectionTitle) {
      md += `## ${clinicalSectionTitle}

${renderClinicalPipeline(agentOutputs.trials, insights.clinicalPipeline)}

---

`
    }

    md += `## Patent Activity

${renderIPLandscape(ipLandscape, agentOutputs.patents, insights.patents)}

---

## Key Publications

${renderCuratedPublications(curatedPublications, agentOutputs.publications, insights.publications)}

---

## Key Organizations

${renderOrganizations(context.topOrganizations, context.fundingStats.orgCount)}

---

## Key Researchers

${renderResearchers(context.topResearchers)}

---

`
  }

  // Next Steps checklist — persona-specific, concrete actions the reader
  // should take after the report. Placed here (after key orgs/researchers,
  // before methodology) so it's the last substantive section.
  if (nextSteps && nextSteps.trim()) {
    md += `## Next Steps

*Concrete actions the report suggests based on what's above. Not exhaustive - use these as a starting checklist you can extend.*

${nextSteps}

---

`
  }

  // METHODOLOGY (same for both personas)
  md += `## About This Report

### Methodology

This report analyzes a curated subset of NIH-funded research projects most relevant to **${topic}**. Projects were identified using semantic search (AI-based conceptual matching) and filtered by match quality.${
    context.interpretation
      ? `\n\n**Search Interpretation Used:** ${context.interpretation.label} - "${context.interpretation.semanticQuery}"`
      : ''
  }

**Note on Funding Figures:** Per-project funding amounts shown in this report are the sum of award totals across all budget periods for each project (not just the most recent year). Funding-by-year figures show actual spend per fiscal year drawn from the underlying NIH RePORTER budget-period rows, so a multi-year project contributes to each year it received funding. The current NIH fiscal year (Oct 1 - Sep 30) is partial when this report is generated; that year is labeled "(YTD)" in tables and charts and should not be compared directly to fully-reported prior years.

**Note on Funding Attribution:** Clinical trials are surfaced through two paths — direct linkage to topically-relevant projects, *and* semantic similarity between the trial's own title and the topic (using the same vector-embedding mechanism that powers project search, gated by a dedicated trial-inclusion threshold). The second path catches trials that sit under broad institutional umbrella awards (e.g., P30 cancer center support grants, CTSA hubs) whose underlying parent grant covers many unrelated programs. Those trials are reported because their titles are clearly about the topic, but their umbrella grants' funding is *not* rolled into Total Committed Funding — only projects whose own abstracts clear the project-relevance threshold contribute to funding totals. This keeps the headline funding number topically attributable rather than inflated by institutional overhead grants that happen to host one relevant program among many.

**Match Quality Tiers:**

| Tier | Similarity | Description |
|------|------------|-------------|
| **Precise** | ≥50% | Highly relevant — directly addresses the topic |
| **Balanced** | ≥35% | Relevant — related research with clear connection |

**Sample Composition:**

| Metric | Value |
|--------|-------|
| Projects Analyzed | ${context.fundingStats.projectCount.toLocaleString()} |
| Precise Matches | ${agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length} |
| Balanced Matches | ${agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length} |
| Total Committed Funding | ${formatCurrency(context.fundingStats.total)} |
| Organizations | ${context.fundingStats.orgCount.toLocaleString()} |
| Principal Investigators | ${context.fundingStats.piCount.toLocaleString()} |

${renderSampleInterpretation(agentOutputs, context)}

**Linked Data:**

| Data Type | Count | Source |
|-----------|-------|--------|
| Clinical Trials | ${agentOutputs.trials.items.length} | ClinicalTrials.gov |
| Patents | ${agentOutputs.patents.items.length} | USPTO |
| Publications | ${agentOutputs.publications.items.length} | PubMed |

### Limitations

This analysis focuses on **depth over breadth**, capturing publicly-funded academic research. It does not include privately-funded industry R&D or international research outside NIH grants.

*Data current as of ${now}.*
`

  // Post-render substitutions. Extracted to post-render.ts so
  // lint-retry can apply the same substitutions to retry-corrected
  // sections (r40 audit found em dashes pervasive because retry
  // bypassed this pass).
  md = applyPostRenderSubstitutions(md)

  // PI-possessive stripping. Uses stripPiPossessives() from
  // post-render.ts against the topResearchers surname list.
  const surnames = new Set<string>()
  for (const r of context.topResearchers.slice(0, 50)) {
    const parts = (r.pi_name || '').split(',')
    const surname = parts[0]?.trim()
    if (surname && surname.length >= 3) surnames.add(surname)
  }
  md = stripPiPossessives(md, surnames)

  return md
}

// --- Render functions ---

/**
 * Boilerplate explaining the value of the report — appears in every report.
 * Articulates why NIH data is a leading indicator (investor) or validator
 * (researcher), and frames our semantic analysis as the core differentiator
 * vs. the supplementary web-sourced market context.
 */
function renderHowToUse(persona: ReportPersona): string {
  const intro =
    persona === 'investor'
      ? 'NIH-funded research is a leading indicator of commercial opportunity. Public funding typically precedes private activity by 3-7 years, so the projects, PIs, IP filings, and clinical programs surfaced here are early signals of which technologies will produce the next wave of companies, partnerships, and deals in this space.'
      : 'NIH funding patterns validate research direction. Knowing who is funded in your space — with what methods, in what collaborations, and at what scale — calibrates where your work fits relative to the field\'s momentum and reveals gaps worth pursuing.'

  const synthesisBullet =
    persona === 'investor'
      ? 'Synthesizing across the analyzed sample to surface patterns no single record reveals — competitive topology, IP concentration, field maturity, and momentum signals'
      : 'Synthesizing across the analyzed sample to surface patterns no single record reveals — methodological trends, collaboration networks, gap analysis, and positioning signals'

  return `${intro}

The intelligence in this report comes primarily from our semantic analysis across the linked data, not from any single source. NIH RePORTER, ClinicalTrials.gov, USPTO, and PubMed are all publicly searchable — anyone can look up individual records. Our value is in:

- Identifying conceptually-related projects via AI semantic search rather than brittle keyword matching
- Cross-linking each project to its associated patents, clinical trials, and publications
- ${synthesisBullet}

The Market Context section adds external color sourced via live web search. It is supplementary to the core analysis above.
`
}

/**
 * Consolidated, upfront acknowledgment of what's NOT in this analysis.
 * Placed after "How to Use This Report" so readers calibrate before
 * engaging with the body. Builds trust through specificity, not apology.
 */
function renderBlindSpots(persona: ReportPersona): string {
  const investorClose =
    'For pure private-market intelligence (funding rounds, M&A, internal pipelines), supplement with PitchBook, CB Insights, or industry analyst reports.'
  const researcherClose =
    'For a complete literature view, supplement with broader PubMed/Web of Science searches and conference proceedings.'
  const closing = persona === 'investor' ? investorClose : researcherClose

  return `*A short, upfront note on the boundaries of this analysis. We surface this so you can read everything below with the right calibration.*

- **Companies are in this data — non-NIH-funded internal R&D is not.** SBIR/STTR grantees, academic-industry partnerships, and commercial entities receiving NIH funding do appear and carry real commercial weight. What's invisible is privately-funded R&D inside companies that doesn't intersect with an NIH grant.
- **International activity is largely outside the sample.** NIH RePORTER captures US grantees and their direct collaborators. Major work in Europe, China, Japan, and elsewhere is not reflected unless tied to a US-funded project.
- **Linked outputs require an NIH grant acknowledgment.** A clinical trial, patent, or publication only appears here if it was filed with an NIH project number. Industry-led trials, non-USPTO patents, and papers without NIH funding acks are missing — even when central to the field.
- **Recent quarter activity may be incomplete.** NIH RePORTER updates with a lag of several weeks; some current-fiscal-year awards may not yet be visible.
- **Umbrella institutional grants are not credited to topic funding.** Some trials and patents in this report are hosted under broad institutional support awards (P30 cancer centers, CTSA hubs, training grants) whose parent grant covers many programs beyond this topic. Those records appear in the trials and patents sections, but the host grants' dollars are deliberately excluded from Total Committed Funding to keep the headline number topically attributable. Real topic activity at those institutions is therefore likely higher than the funding figures alone suggest.
- **Market context is web-sourced**, not exhaustive — see the Sources subsection in Market Context for what was retrieved.
- **Project categorization is automated.** A single primary category is assigned per project by AI classification, with confidence scores. Some boundary cases (especially infrastructure vs. biotools) may be misassigned.

This is depth-over-breadth analysis — high signal on what NIH funds and produces, including its commercial recipients. ${closing}
`
}

function renderFieldMaturity(maturity: FieldMaturityAssessment): string {
  let md = ''

  // Disclaimer about sample-based assessment
  md += '*Note: This assessment is based on NIH-linked clinical trials, patents, and publications. It reflects patterns in the analyzed sample and may not represent the full global research landscape.*\n\n'

  // Overall assessment badge/indicator
  const assessmentLabels: Record<string, string> = {
    nascent: 'Nascent - Early basic research',
    emerging: 'Emerging - Proof of concept stage',
    maturing: 'Maturing - Technology validation underway',
    established: 'Established - Commercial applications exist',
  }

  md += `**Technology Readiness:** ${maturity.trlEstimate}\n\n`
  md += `**Overall Assessment:** ${assessmentLabels[maturity.overallAssessment] || maturity.overallAssessment}\n\n`

  if (maturity.benchmarkComparison) {
    md += `**Historical Reference Point:** ${maturity.benchmarkComparison}\n\n`
  }

  if (maturity.maturityNarrative) {
    md += maturity.maturityNarrative + '\n\n'
  }

  // Evidence summary as a structured list
  if (maturity.evidenceSummary.preprintRatio || maturity.evidenceSummary.trialProgression || maturity.evidenceSummary.patentActivity) {
    md += '### Supporting Evidence\n\n'

    if (maturity.evidenceSummary.preprintRatio) {
      md += `- **Publication Maturity:** ${maturity.evidenceSummary.preprintRatio}\n`
    }
    if (maturity.evidenceSummary.trialProgression) {
      md += `- **Clinical Progression:** ${maturity.evidenceSummary.trialProgression}\n`
    }
    if (maturity.evidenceSummary.patentActivity) {
      md += `- **IP Activity:** ${maturity.evidenceSummary.patentActivity}\n`
    }
    md += '\n'
  }

  if (maturity.strategicImplications) {
    md += '### Strategic Implications\n\n'
    md += maturity.strategicImplications + '\n\n'
  }

  return md || 'Field maturity assessment not available.\n'
}

function renderCompetitiveTopology(topology: CompetitiveTopology): string {
  if (topology.clusters.length === 0) {
    return 'Competitive topology analysis not available.\n'
  }

  const n = topology.clusters.length

  let md = ''

  // Disclaimer about NIH-linked sample + methodological transparency
  // on where the cluster count comes from. Without this, "5 clusters"
  // reads as if 5 were inherent to the field; in reality it's whatever
  // the topology synthesizer resolves from the project abstracts, and
  // the number varies by topic (typically 3-5).
  md += `*Note: Key players listed below are derived from NIH-funded project data and represent academic/research institutions. Commercial entities may not appear. The ${n} clusters below are the methodological groupings the synthesis identified as most distinct in the analyzed abstracts - clusters are cross-cutting (a single project can belong to more than one), and a different cut of the data could resolve at 3 or 6 clusters rather than ${n}.*\n\n`

  if (topology.narrative) {
    md += topology.narrative + '\n\n'
  }

  // Cluster listing. Previously rendered as a markdown table but the
  // Confidence/Evidence tags inside commercialReadiness contain \n\n
  // paragraph breaks (inserted by normalizeConfidenceTagSpacing so
  // tags land on their own line) - those newlines break the table
  // row layout in inconsistent ways, producing r40's uneven display
  // where one row's tag stays inside the cell and the next spans
  // full width. Block-per-cluster format renders each Confidence tag
  // consistently full-width below its cluster's facts.
  md += '### Methodological Clusters\n\n'
  topology.clusters.forEach((cluster, i) => {
    const players = cluster.keyPlayers.slice(0, 4).join(', ')
    const playersDisplay = cluster.keyPlayers.length > 4 ? `${players}, ...` : players
    md += `#### ${i + 1}. ${cluster.approach}\n\n`
    md += `- **Key Players:** ${playersDisplay}\n`
    md += `- **Maturity:** ${cluster.maturityLevel}\n`
    md += `- **Commercial Readiness:** ${cluster.commercialReadiness}\n\n`
    md += '---\n\n'
  })

  if (topology.strategicImplications) {
    md += '### Strategic Implications\n\n'
    md += topology.strategicImplications + '\n\n'
  }

  return md
}

/**
 * Render the "What Surprised Us" section. Each finding is a bold hook
 * followed by 2-3 sentences of interpretation and the concrete evidence
 * line. Category is not shown to the reader — it's a downstream tag for
 * deduplication + future filtering.
 */
function renderSurprisingFindings(findings: SurprisingFinding[]): string {
  if (findings.length === 0) return ''
  let md = ''
  findings.forEach((f, i) => {
    md += `**${i + 1}. ${f.headline}**\n\n`
    md += `${f.interpretation}\n\n`
    // Confidence tag on What Surprised Us findings. r31 audit flagged
    // a double-Evidence pattern: the interpretation sometimes carried
    // a Confidence + Evidence tag inline AND the render emitted a
    // separate italic Evidence line, restating the same figures with
    // slightly different phrasing. Fix: only append a fallback line
    // when the interpretation lacks a Confidence tag AND we haven't
    // already surfaced Evidence in the interpretation.
    const hasTag = /\*\*Confidence:\s*(High|Medium|Low)\*\*/.test(f.interpretation)
    const interpretationHasEvidence = /Evidence:/i.test(f.interpretation)
    if (!hasTag) {
      // No Confidence tag at all - append one with Evidence.
      md += `**Confidence: Low** - Evidence: ${f.evidence}\n\n`
    } else if (!interpretationHasEvidence) {
      // Tag present but Evidence missing - emit italic Evidence line
      // to complete the pattern.
      md += `*Evidence: ${f.evidence}*\n\n`
    }
    // else: interpretation already has Confidence + Evidence inline;
    // do not emit anything additional (prevents double-Evidence).
  })
  return md
}

function renderWhiteSpace(ws: WhiteSpaceAnalysis): string {
  let md = ''

  // Scope caveat first — the reader needs to know what "NIH-funded" means
  // and doesn't mean before interpreting counts.
  md += `*${ws.scopeNote}*\n\n`

  // Surface the scope-universe count immediately after the scope caveat.
  // A "Broader NIH" cell showing 82 reads very differently against a
  // ~4,000-project scope universe than against the 154K raw NIH
  // universe. Making the base rate visible closes that credibility gap
  // — reader can compute the share themselves. Only render when we
  // successfully counted (scope filter active + query succeeded).
  if (typeof ws.scopeUniverseCount === 'number' && ws.scopeUniverseCount > 0) {
    const scopeLabel = ws.broaderNihScopeLabel || 'the topic scope'
    md += `> **Base rate for "Broader NIH" columns:** every broader-NIH cell below is drawn from **${ws.scopeUniverseCount.toLocaleString()} NIH projects** matching the ${scopeLabel} scope filter — not the full ~154K RePORTER universe. Read broader-NIH counts as shares of that ${ws.scopeUniverseCount.toLocaleString()}-project scope, not of all NIH funding.\n\n`
  }

  // Overview narrative
  if (ws.overview) {
    md += `### Overview\n\n${ws.overview}\n\n`
  }

  // Per-dimension: heading, chart marker (the MarkdownRenderer swaps this
  // for a WhiteSpaceCoverageChart component), table with counts, narrative.
  for (let dIdx = 0; dIdx < ws.dimensions.length; dIdx++) {
    const dim = ws.dimensions[dIdx]
    md += `### Coverage by ${dim.name}\n\n`
    if (dim.description) md += `*${dim.description}*\n\n`

    // Chart marker with dimension index — the renderer looks up the
    // dimension by index against whiteSpace.dimensions.
    md += `<!-- chart:white-space-dimension:${dIdx} -->\n\n`

    // Fallback table in case the chart doesn't render (PDF export path,
    // markdown-only view, etc.). Uses the same numbers the chart shows.
    // Column label reflects the scope-filtered comparator when scope is
    // active — makes clear the broader count is topically scoped, not
    // raw keyword prevalence.
    const broaderHeader = ws.broaderNihScopeLabel
      ? `Broader NIH (${ws.broaderNihScopeLabel})`
      : 'Broader NIH'
    // Keyword-artifact detection. Three signals, any of which flags a
    // category's broader-NIH cell with a [†] dagger:
    //   1. Broader count >= 5x the dimension median (tightened from 10x
    //      after Opus r30 flagged ML at 23 vs median 2 = 11.5x, but my
    //      previous median calc used upper-middle for even-length arrays
    //      and computed median=8 not 2, missing the flag).
    //   2. Category name matches a curated generic-term list. Some
    //      keywords ("machine learning", "biomarker", "statistical")
    //      match huge swaths of biomedical research REGARDLESS of ratio,
    //      because they're broad by nature. Curated list forces the
    //      dagger for those regardless of the median comparison.
    //   3. Broader count is more than 2x the sum of the second-and-third
    //      largest in the dimension — catches strong outliers even when
    //      the median is inflated by another outlier.
    const broaderCounts = dim.categories
      .map((c) => c.broaderNihCount)
      .filter((n) => n > 0 && n !== -1)
      .sort((a, b) => a - b)
    // True statistical median (average of two middles for even arrays).
    let medianBroader = 0
    if (broaderCounts.length > 0) {
      const mid = Math.floor(broaderCounts.length / 2)
      medianBroader =
        broaderCounts.length % 2 === 0
          ? (broaderCounts[mid - 1] + broaderCounts[mid]) / 2
          : broaderCounts[mid]
    }
    const OUTLIER_MULTIPLE = 5

    // Generic terms known to over-match against broad biomedical corpora.
    // If a category NAME contains any of these tokens, the row auto-flags
    // regardless of the ratio math. r30 audit surfaced "machine learning"
    // at 23 broader-NIH — the ratio didn't dagger, but the term itself is
    // a canonical generic-prevalence trap.
    // Whole-word matching (r32 audit fix): previous substring rules
    // false-flagged "Hydroxymethylation" and "Methylation-Specific
    // Assays" as generic because "methylation" was a substring. Now
    // each pattern requires a word boundary so only the standalone
    // term matches.
    const GENERIC_TERM_PATTERNS = [
      /\bmachine learning\b/i,
      /\bml\b/i,
      /\bartificial intelligence\b/i,
      /\bai\b/i,
      /\bdeep learning\b/i,
      /\bneural networks?\b/i,
      /\bbiomarkers?\b(?!.*(?:discovery|panel|specific))/i,
      /\bcomputational\b/i,
      /\bbioinformatics?\b/i,
      /\bstatistical\b/i,
      /\bmethylation\b/i, // "DNA Methylation" yes; "Hydroxymethylation" no
      /\bexosomes?\b/i,
    ]
    const nameLooksGeneric = (name: string): boolean =>
      GENERIC_TERM_PATTERNS.some((r) => r.test(name))

    const isKeywordArtifact = (cat: (typeof dim.categories)[number]): boolean => {
      const n = cat.broaderNihCount
      if (n <= 0 || n === -1) return false
      // r36 audit recalibration: previous logic daggered generic-term
      // categories with count >= 15 regardless of ratio, which flagged
      // "Aberrant Methylation (31)" and "cfDNA Mutation (101)" when
      // their in-dimension ratios were only 1.2x and 2.5x median - not
      // actually outliers. Fix: generic-term must ALSO have a
      // meaningful ratio (>= 3x median, weaker than the standalone
      // 5x rule) OR a much higher absolute count (>= 100) to dagger.
      // This eliminates false-positives on low-multiplier generic
      // categories while still catching Methylation=195 or
      // Exosomes=417 (both >= 5x their peers).
      if (nameLooksGeneric(cat.name)) {
        if (medianBroader > 0 && n / medianBroader >= 3) return true
        if (n >= 100) return true
        return false
      }
      // Signal 1: ratio to median.
      if (medianBroader > 0 && n / medianBroader >= OUTLIER_MULTIPLE) return true
      // Signal 3: gap to next-largest peers. If this is the max and it's
      // more than 2x the sum of the next two, it's a distributional
      // outlier even when median is high.
      if (broaderCounts.length >= 3 && n === broaderCounts[broaderCounts.length - 1]) {
        const nextTwoSum =
          broaderCounts[broaderCounts.length - 2] + broaderCounts[broaderCounts.length - 3]
        if (nextTwoSum > 0 && n / nextTwoSum >= 2) return true
      }
      return false
    }

    md += `| Category | Projects | % of Sample | Funding | ${broaderHeader} |\n`
    md += `|----------|---------:|------------:|--------:|------------:|\n`
    let anyArtifact = false
    for (const cat of dim.categories) {
      const share = ws.totalProjects > 0 ? (cat.projectCount / ws.totalProjects) * 100 : 0
      let broaderCell: string
      if (cat.broaderNihCount === -1) {
        broaderCell = 'n/a'
      } else if (isKeywordArtifact(cat)) {
        broaderCell = `${cat.broaderNihCount.toLocaleString()} [†]`
        anyArtifact = true
      } else {
        broaderCell = cat.broaderNihCount.toLocaleString()
      }
      md += `| ${cat.name} | ${cat.projectCount} | ${share.toFixed(1)}% | $${(cat.fundingTotal / 1_000_000).toFixed(1)}M | ${broaderCell} |\n`
    }
    md += '\n'

    if (anyArtifact) {
      // Callout language tightened per r30 audit — the previous "all of
      // cancer biology" phrasing contradicted the scope-universe callout
      // (which says broader-NIH counts are bounded to the scope filter).
      // The dagger explanation now uses "within the topic scope" so it's
      // consistent with the base-rate framing.
      md += `> [†] Rows marked with a dagger are broader-NIH outliers - either their broader count is much higher than the dimension median (>=${OUTLIER_MULTIPLE}x) or the category name contains a generic biomedical term ("machine learning", "biomarker", "methylation") that over-matches within the topic scope. These counts likely reflect generic keyword prevalence within the scope-filtered universe rather than topic-specific activity. Treat as directional only; do not anchor coverage inferences on daggered cells.\n\n`
    }

    // Multi-label sum caveat under each coverage table. Category rows
    // are non-exclusive - a project can appear in multiple categories,
    // so the row-count sum can exceed the total classified projects.
    // Without this note, a reader who adds a table's rows sees a number
    // that doesn't match the caption (r30 audit).
    md += `*Rows are non-exclusive: a project can appear in more than one category, so the sum of the Projects column can exceed ${dim.totalMatched} classified projects.*\n\n`

    // Show the exact keyword set behind each category so readers can see
    // what was counted. Prevents the credibility gap where a category
    // name reads as a broad superset (e.g. "Non-plasma Biofluids") but
    // its keywords only catch meta-framed studies — a reader searching
    // the chat interface for the broader concept sees a much larger
    // count and thinks the report is wrong. Exposing the keywords makes
    // the framing verifiable rather than opaque.
    const hasAnyKeywords = dim.categories.some((c) => c.keywords && c.keywords.length > 0)
    if (hasAnyKeywords) {
      md += `*Keywords per category (what was counted):*\n\n`
      for (const cat of dim.categories) {
        if (!cat.keywords || cat.keywords.length === 0) continue
        md += `- **${cat.name}**: ${cat.keywords.map((k) => `\`${k}\``).join(', ')}\n`
      }
      md += '\n'
    }

    if (dim.narrative) {
      md += `${dim.narrative}\n\n`
    }
  }

  // Ranked opportunities — framed as candidate signals rather than
  // confirmed opportunities. The sample is a tight semantic match to
  // the topic; the "broader NIH" comparator is a looser keyword-based
  // match against the scope. A gap between the two could be a real
  // underexplored intersection, a vocabulary mismatch, or a broader
  // count that includes topic-adjacent-but-not-in-scope work our
  // semantic filter correctly excluded. Naming this "Signals" and
  // hedging in the header keeps the ranking useful without overclaiming.
  if (ws.topOpportunities.length > 0) {
    md += `### Coverage Gap Signals\n\n`
    md += `*Candidate gaps ranked by **share-normalized** comparison: broader-NIH share of the scope universe divided by sample share. A category only ranks as a gap when its broader-share materially exceeds its sample-share (>=2x). Raw count ratios are misleading when the sample universe (${ws.totalProjects.toLocaleString()} projects) and scope universe (${ws.scopeUniverseCount?.toLocaleString() ?? 'n/a'} projects) differ in size, so the shares are computed against those denominators directly. Signals here are still **directional** - the sample uses semantic matching, broader-NIH uses title-only keyword matching, and vocabulary drift can shift shares in either direction.*\n\n`
    ws.topOpportunities.forEach((op, i) => {
      const sampleSharePct = (op.sampleShare * 100).toFixed(1)
      const broader = op.broaderNihCount === -1 ? 'not queried' : op.broaderNihCount.toLocaleString()
      const scopeUniv = ws.scopeUniverseCount
      const broaderSharePct =
        typeof scopeUniv === 'number' && scopeUniv > 0 && op.broaderNihCount > 0
          ? ((op.broaderNihCount / scopeUniv) * 100).toFixed(1)
          : null
      const shareRatio =
        broaderSharePct !== null && op.sampleShare > 0
          ? (parseFloat(broaderSharePct) / (op.sampleShare * 100)).toFixed(1)
          : null
      md += `**${i + 1}. ${op.categoryName}** (${op.dimensionName})\n\n`
      md += `- Analyzed sample: **${op.sampleCount}** projects (${sampleSharePct}% of ${ws.totalProjects} sample projects)\n`
      if (broaderSharePct !== null && scopeUniv) {
        md += `- Broader ${ws.broaderNihScopeLabel || 'NIH RePORTER'}: **${broader}** matching projects (${broaderSharePct}% of ${scopeUniv.toLocaleString()} scope universe)\n`
        md += `- **Share ratio:** broader-share is ${shareRatio}x sample-share - this is what identifies the gap, not the raw count difference.\n`
      } else {
        md += `- Broader ${ws.broaderNihScopeLabel || 'NIH RePORTER'}: **${broader}** matching projects\n`
      }
      if (op.sampleCount <= 1) {
        md += `- **Small-sample caveat:** the ratio here rests on ${op.sampleCount === 0 ? 'zero' : 'one'} topic project. A single classification change to the topic sample could shift the signal substantially. Treat as directional only.\n`
      }
      if (op.rationale) md += `\n${op.rationale}\n`
      md += '\n'
    })
  }

  if (ws.strategicImplications) {
    md += `### Strategic Implications\n\n`
    md += ws.strategicImplications + '\n\n'
  }

  return md
}

function renderIPLandscape(landscape: IPLandscapeAssessment, patents: AllAgentOutputs['patents'], insight: string): string {
  let md = ''

  // Disclaimer about NIH-linked sample + patent data lag callout (r19+
  // audit feedback: readers should know that USPTO filings can lag
  // commercial activity by 18-24 months, so recent private R&D may not
  // show here even when it exists).
  md += '*Note: This analysis includes only patents linked to NIH-funded projects. Commercial patents and international filings may exist outside this sample. USPTO filing timelines also lag commercial activity by roughly 18-24 months, so very recent private R&D may not yet appear in patent data.*\n\n'

  // Add the strategic IP assessment first
  const concentrationLabels: Record<string, string> = {
    fragmented: 'Fragmented - Many players, no dominant owner',
    moderately_concentrated: 'Moderately Concentrated - Several key players',
    highly_concentrated: 'Highly Concentrated - Few dominant owners',
    insufficient_sample: 'Insufficient sample to characterize',
  }

  // Below this threshold, "Moderately Concentrated" is a label the sample
  // can't actually support. Fable's r22 audit called this out: a 4-patent
  // sample tagged "Moderately Concentrated" implies a landscape read the
  // data doesn't earn. When N is small, replace the confident label with
  // an explicit "insufficient sample" framing so the label doesn't fight
  // the confidence tags in the section below.
  const IP_LABEL_MIN_N = 10
  const totalLinkedPatents = patents.items.length
  const concentrationDisplay =
    totalLinkedPatents < IP_LABEL_MIN_N
      ? `Insufficient sample to characterize (${totalLinkedPatents} grant-linked patent${totalLinkedPatents === 1 ? '' : 's'} - a landscape label like "concentrated" or "fragmented" requires at least ${IP_LABEL_MIN_N} patents to be meaningful; the shape below is descriptive of this specific sample, not the broader IP landscape)`
      : concentrationLabels[landscape.concentration] || landscape.concentration

  md += `**IP Concentration:** ${concentrationDisplay}\n\n`

  if (landscape.dominantAssignees.length > 0) {
    const label = totalLinkedPatents < IP_LABEL_MIN_N ? 'Patent Holders in Sample' : 'Dominant Patent Holders'
    md += `**${label}:** ${landscape.dominantAssignees.join(', ')}\n\n`
  }

  if (landscape.recentActivityTrend) {
    md += `**Recent Activity:** ${landscape.recentActivityTrend}\n\n`
  }

  if (landscape.freedomToOperate) {
    md += '### Freedom to Operate Assessment\n\n'
    md += landscape.freedomToOperate + '\n\n'
  }

  if (landscape.narrative) {
    md += landscape.narrative + '\n\n'
  }

  if (landscape.strategicImplications) {
    md += '### Strategic Implications\n\n'
    md += landscape.strategicImplications + '\n\n'
  }

  // Then add the standard patent section with insight and details
  if (insight) {
    md += '### Patent Analysis\n\n'
    md += insight + '\n\n'
  }

  // Distinguish attributed vs. unattributed patents in the summary. r25
  // audit flagged that two patents with null assignees (both HCC microRNA,
  // 2012-2013) were counted in the headline "8 patents / 4 assignees"
  // figure, reintroducing a small data-integrity concern. Now we surface
  // both counts so a reviewer can see attribution coverage explicitly.
  const attributedPatents = patents.items.filter(
    (p) => p.assignee && p.assignee.trim().length > 0,
  )
  const unattributedCount = patents.items.length - attributedPatents.length

  md += '### Patent Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Patents (grant-linked) | ${patents.items.length} |\n`
  if (unattributedCount > 0) {
    md += `| With Assignee on Record | ${attributedPatents.length} |\n`
    md += `| Assignee Missing | ${unattributedCount} |\n`
  }
  md += `| Unique Assignees | ${patents.byAssignee.length} |\n`
  md += `| Recent (2 years) | ${patents.recentCount} |\n\n`
  if (unattributedCount > 0) {
    md += `*${unattributedCount} of ${patents.items.length} linked patent${patents.items.length === 1 ? '' : 's'} ${unattributedCount === 1 ? 'has' : 'have'} no assignee on record and ${unattributedCount === 1 ? 'is' : 'are'} listed below with an "assignee not on record" tag. These are still grant-linked (an NIH project number appears in the patent record) but should be treated separately from assignee-based aggregates.*\n\n`
  }

  if (patents.items.length > 0) {
    md += '### Key Patents\n\n'
    patents.items.slice(0, 15).forEach((p) => {
      md += `#### ${p.patent_title || 'Untitled Patent'}\n`
      md += `- **Patent #:** [${p.patent_id}](/patent/${p.patent_id})\n`
      // Always emit Assignee — surface "Not on record" when USPTO
      // doesn't have one rather than silently omitting the field.
      md += `- **Assignee:** ${p.assignee?.trim() || 'Not on record'}\n`
      md += `- **Date:** ${p.patent_date || 'Not on record'}\n`
      if (p.patent_abstract) {
        const excerpt = p.patent_abstract.substring(0, 200) + (p.patent_abstract.length > 200 ? '...' : '')
        md += `\n> ${excerpt}\n`
      }
      md += '\n'
    })
  }

  return md
}

function renderInvestorSignals(signals: SignalsAnalysis): string {
  let md = ''

  if (signals.trlAssessment) {
    md += '### Technology Readiness Assessment\n\n'
    md += signals.trlAssessment + '\n\n'
  }

  if (signals.commercialReadiness) {
    md += '### Commercial Readiness\n\n'
    md += signals.commercialReadiness + '\n\n'
  }

  if (signals.ipConcentration) {
    md += '### IP Concentration\n\n'
    md += signals.ipConcentration + '\n\n'
  }

  // Render risk factors as explicit bullet list
  if (signals.riskFactors) {
    md += '### Investment Risk Flags\n\n'

    // Check if riskFactors is structured (object) or legacy (string)
    if (typeof signals.riskFactors === 'object') {
      const risks = signals.riskFactors as InvestorRiskFactors

      // Overall summary first
      if (risks.overall) {
        md += `**Key Risk:** ${risks.overall}\n\n`
      }

      // Categorized risks as explicit bullets
      const riskCategories: Array<{ key: keyof InvestorRiskFactors; label: string }> = [
        { key: 'scientific', label: 'Scientific/Technical' },
        { key: 'regulatory', label: 'Regulatory' },
        { key: 'competitive', label: 'Competitive/Market' },
        { key: 'execution', label: 'Execution' },
      ]

      const activeRisks = riskCategories.filter(
        cat => cat.key !== 'overall' && risks[cat.key]
      )

      if (activeRisks.length > 0) {
        activeRisks.forEach(({ label, key }) => {
          const value = risks[key]
          if (value && key !== 'overall') {
            md += `- **${label}:** ${value}\n`
          }
        })
        md += '\n'
      }
    } else {
      // Legacy string format
      md += signals.riskFactors + '\n\n'
    }
  }

  if (signals.comparables) {
    md += '### Comparable Technologies\n\n'
    md += signals.comparables + '\n\n'
  }

  return md || 'Investment signals analysis not available.\n'
}

function renderResearcherSignals(signals: SignalsAnalysis): string {
  let md = ''

  if (signals.positioningMap) {
    md += '### Competitive Positioning\n\n'
    md += signals.positioningMap + '\n\n'
  }

  if (signals.collaborationSignals) {
    // r41 audit: "Collaboration Opportunities" header + named
    // institutions below reads as a target list even when the prose
    // is descriptive. Rename to a purely descriptive framing so the
    // header itself carries no prescriptive weight.
    md += '### Multi-Method Concentration Patterns\n\n'
    md += signals.collaborationSignals + '\n\n'
  }

  if (signals.methodologicalTrends) {
    md += '### Methodological Trends\n\n'
    md += signals.methodologicalTrends + '\n\n'
  }

  // Gap Analysis subsection was removed once the dedicated "White Space
  // Analysis" section shipped — that section replaces this one with a
  // quantified, multi-dimensional gap audit backed by real counts.

  return md || 'Research positioning analysis not available.\n'
}

function renderCuratedPublications(
  curated: CuratedPublication[],
  allPubs: AllAgentOutputs['publications'],
  insight: string
): string {
  if (curated.length === 0 && allPubs.items.length === 0) {
    return '*Note: This analysis includes only publications linked to NIH-funded projects.*\n\nNo publications found linked to NIH projects in this space.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only publications linked to NIH-funded projects and may not represent the complete body of literature in this field. PubMed indexing typically lags publication date by 1-3 months for peer-reviewed articles; preprints appear faster but are not peer-reviewed.*\n\n'

  // Lead-in narrative from generateSectionInsights — what scientific questions
  // are being addressed and which methodological advances are visible.
  if (insight) {
    md += insight + '\n\n'
  }

  // Show curated publications if available
  if (curated.length > 0) {
    md += '### Must-Read Publications\n\n'
    curated.forEach((pub, i) => {
      md += `#### ${i + 1}. ${pub.title}\n`
      md += `- **Journal:** ${pub.journal ? normalizeJournalName(pub.journal) : 'N/A'} | **Year:** ${pub.year || 'N/A'}\n`
      md += `- **PMID:** [${pub.pmid}](https://pubmed.ncbi.nlm.nih.gov/${pub.pmid})\n`
      md += `\n**Why it matters:** ${pub.significance}\n`
      md += `\n**Key finding:** ${pub.keyFinding}\n\n`
    })
  }

  // Show publication stats
  if (allPubs.items.length > 0) {
    md += '### Publication Summary\n\n'
    md += `- Total linked publications: ${allPubs.items.length}\n`
    md += `- Unique journals: ${allPubs.totalUniqueJournals}\n`

    // Reconcile total vs. sum-of-byYear so a reader who adds the year
    // column doesn't hit a gap they can't explain. Some PubMed rows
    // lack pub_year metadata (typically older records or non-standard
    // pubdate formats that our year regex couldn't parse); those are
    // in the total but not in the year distribution.
    const yearSum = (allPubs.byYear || []).reduce((s, y) => s + (y.count || 0), 0)
    const yearlessCount = allPubs.items.length - yearSum
    if (yearlessCount > 0) {
      md += `- Publications with year metadata: ${yearSum} (the remaining ${yearlessCount} have no parsable year on the PubMed record and are not shown in the year distribution below)\n`
    }
    md += '\n'

    // Only show "Top Journals" list if at least one journal has 2+ pubs (otherwise it's noise)
    const topJournalCount = allPubs.byJournal[0]?.count ?? 0
    if (allPubs.byJournal.length > 0 && topJournalCount >= 2) {
      md += '**Top Journals:**\n\n'
      allPubs.byJournal
        .filter((j) => j.count >= 2)
        .slice(0, 5)
        .forEach((j) => {
          md += `- ${normalizeJournalName(j.journal)} (${j.count})\n`
        })
      md += '\n'
    }
  }

  return md
}

function renderMarketContext(market: MarketContext): string {
  let md = '### Market Overview\n\n'
  md += '*Market context below is synthesized from current web search results. See sources at the end of this section. NIH funding patterns are integrated to bridge public research and commercial activity.*\n\n'
  md += market.overview + '\n\n'

  if (market.marketSize) {
    md += `**Market Sizing:** ${market.marketSize}\n\n`
  }

  if (market.keyPlayers.length > 0) {
    md += '### Key Players\n\n'
    md += '*These players are identified from market reports and trade press, and may differ from the NIH-funded organizations analyzed elsewhere in this report.*\n\n'
    market.keyPlayers.forEach((player) => {
      md += `- ${player}\n`
    })
    md += '\n'
  }

  if (market.recentDevelopments.length > 0) {
    md += '### Recent Developments\n\n'
    market.recentDevelopments.forEach((dev) => {
      md += `- ${dev}\n`
    })
    md += '\n'
  }

  if (market.competitiveLandscape) {
    md += '### Competitive Landscape\n\n'
    md += market.competitiveLandscape + '\n\n'
  }

  // Render sources — distinguish URLs from descriptive labels
  if (market.sources.length > 0) {
    md += '### Sources\n\n'
    md += '*Live web sources retrieved during report generation. Click to verify.*\n\n'
    market.sources.forEach((src) => {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        // Extract a short readable label from the URL host
        try {
          const u = new URL(src)
          md += `- [${u.hostname}${u.pathname.length > 1 ? u.pathname : ''}](${src})\n`
        } catch {
          md += `- [${src}](${src})\n`
        }
      } else {
        md += `- ${src}\n`
      }
    })
    md += '\n'
  }

  return md
}

function renderFundingLandscape(stats: FundingStats, insight: string): string {
  let md = ''
  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Funding Summary\n\n'
  md += '*Funding figures sum award amounts across all budget periods for each project. Each fiscal year reflects actual spend in that year, not the most recent budget period only. Totals only include projects that meet the topic-relevance threshold — umbrella support grants (e.g., P30 cancer centers) that host a relevant trial but cover many unrelated programs are intentionally excluded so the headline number stays topically attributable.*\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Committed Funding | ${formatCurrency(stats.total)} |\n`
  md += `| Active Projects | ${stats.projectCount.toLocaleString()} |\n`
  md += `| Funding Organizations | ${stats.orgCount.toLocaleString()} |\n`
  md += `| Principal Investigators | ${stats.piCount.toLocaleString()} |\n\n`

  if (stats.byYear.length > 0) {
    md += '### Funding by Year\n\n'
    if (stats.byYear.length >= 2) {
      md += '<!-- chart:funding-by-year -->\n\n'
    }
    md += '| Year | Projects | Funding |\n'
    md += '|------|----------|--------|\n'
    stats.byYear.slice(0, 10).forEach((row) => {
      const yearLabel = row.isPartial ? `FY${row.year} (YTD)` : `FY${row.year}`
      md += `| ${yearLabel} | ${row.projects} | ${formatCurrency(row.funding)} |\n`
    })
    md += '\n'
    // Multi-year project note. r36 audit flagged that per-year project
    // counts sum to more than the total (e.g. 20+83+85=188 vs 123
    // total sample) because a multi-year project appears in every FY
    // it received funding. The methodology block explains this
    // ~4 sections earlier, but a reader scanning the table can hit
    // 188>123 and assume error before finding the note. Inline
    // footnote closes that gap.
    md += `*The Projects column counts each project in every year it received funding, so per-year counts sum to more than the ${stats.projectCount}-project sample total. Funding amounts are actual per-year spend from NIH RePORTER budget-period rows.*\n\n`
    if (stats.partialFYNote) {
      md += `*${stats.partialFYNote} The YTD figure should not be compared directly to fully-reported prior years.*\n\n`
    }
  }

  if (stats.byCategory.length > 0) {
    md += '### Top Funding Categories\n\n'
    if (stats.byCategory.length >= 2) {
      md += '<!-- chart:categories -->\n\n'
    }
    md += '| Category | Projects | Funding |\n'
    md += '|----------|----------|--------|\n'
    // Render all categories, not just top 5 — the chart above shows the
    // full distribution, and truncating the table at 5 while the chart
    // shows 6+ produces a "why is Medical Device in the chart but not
    // the table?" credibility gap (r28 audit).
    stats.byCategory.forEach((row) => {
      md += `| ${formatCategory(row.category)} | ${row.projects} | ${formatCurrency(row.funding)} |\n`
    })
    md += '\n'
  }

  return md
}

// The projects agent returns items sorted by semantic similarity. The
// "Top Funded Projects" section needs them ranked by total_cost desc, so
// we re-sort before slicing. Defensive .slice() so we don't mutate the
// caller's array (other sections still rely on similarity order).
function topFundedProjects(projects: ProjectItem[], n: number): ProjectItem[] {
  return projects
    .slice()
    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
    .slice(0, n)
}

function renderProjects(projects: ProjectItem[], projectInsights?: Record<string, string>): string {
  if (projects.length === 0) {
    return 'No projects found for this topic in our database.\n'
  }

  let md = '### Top Funded Projects\n\n'
  md += '*Funding is the sum of award totals across all budget periods for each project. Latest activity is the most recent fiscal year the project received an award. Category is auto-assigned by AI classification and may occasionally misassign monitoring-oriented diagnostic projects as therapeutics — the abstract is the ground truth for what the project actually does.*\n\n'

  projects.forEach((p, i) => {
    md += `#### ${i + 1}. ${p.title}\n`
    md += `- **PI:** ${p.pi_names?.split(';')[0]?.trim() || 'N/A'}`
    if (p.org_name) md += `, ${normalizeOrgName(p.org_name)}`
    md += '\n'
    md += `- **Funding:** ${formatCurrency(p.total_cost || 0)}`
    if (p.fiscal_year) md += ` (latest activity FY${p.fiscal_year})`
    md += '\n'
    if (p.primary_category) {
      md += `- **Category:** ${formatCategory(p.primary_category)}\n`
    }

    // Add project insight if available
    const insight = projectInsights?.[p.application_id]
    if (insight) {
      md += `\n**Insight:** ${insight}\n`
    }

    // Clean and display narrative
    const cleanedNarrative = cleanNarrative(p.abstract)
    if (cleanedNarrative) {
      const excerpt = cleanedNarrative.substring(0, 300) + (cleanedNarrative.length > 300 ? '...' : '')
      md += `\n> ${excerpt}\n`
    }
    md += `\n[View Project ->](/project/${p.application_id})\n\n`
  })

  return md
}

function renderClinicalPipeline(trials: AllAgentOutputs['trials'], insight: string): string {
  if (trials.items.length === 0) {
    return '*Note: This analysis includes only clinical trials linked to NIH-funded projects.*\n\nNo clinical trials found linked to NIH projects in this space.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only clinical trials linked to NIH-funded projects. Industry-sponsored and international trials may exist outside this sample.*\n\n'

  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Trial Summary\n\n'
  if (Object.keys(trials.byPhase).length >= 2) {
    md += '<!-- chart:trials-by-phase -->\n\n'
  }
  md += '**By Phase**\n\n'
  md += '| Phase | Count |\n'
  md += '|-------|-------|\n'
  Object.entries(trials.byPhase)
    .sort((a, b) => {
      const order = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Early Phase 1', 'N/A', 'Unknown']
      return order.indexOf(a[0]) - order.indexOf(b[0])
    })
    .forEach(([phase, count]) => {
      md += `| ${phase} | ${count} |\n`
    })

  // Data-driven explanation for phase-distribution shape. Diagnostic /
  // biomarker-validation trials are structurally observational — they
  // collect samples and analyze, they don't randomize patients to
  // treatments — so ClinicalTrials.gov marks them with no phase
  // (routed to N/A here). Without this explainer, a reader seeing 87%
  // N/A on a diagnostics-topic report reasonably wonders if we lost
  // phase data. Compute observational/interventional counts from the
  // actual items and explain the split when N/A dominates.
  const totalTrials = trials.items.length
  const observationalCount = trials.items.filter(
    (t) => (t.study_type || '').toUpperCase() === 'OBSERVATIONAL',
  ).length
  const interventionalCount = trials.items.filter(
    (t) => (t.study_type || '').toUpperCase() === 'INTERVENTIONAL',
  ).length
  const otherStudyTypeCount = totalTrials - observationalCount - interventionalCount
  const naCount = trials.byPhase['N/A'] || 0
  // Count interventional trials that carry an actual phase label.
  // Interventional does NOT imply phased — some interventional trials
  // are unphased in ClinicalTrials.gov. r29 audit flagged the framing
  // "phase-labeled = interventional subset" as misleading when only 6
  // of 16 interventional trials carried a phase.
  const interventionalPhased = trials.items.filter((t) => {
    if ((t.study_type || '').toUpperCase() !== 'INTERVENTIONAL') return false
    const p = (t.phase || '').toLowerCase()
    return p.includes('phase') && !p.includes('n/a') && !p.includes('unknown')
  }).length
  const interventionalUnphased = Math.max(0, interventionalCount - interventionalPhased)
  if (totalTrials > 0 && naCount / totalTrials >= 0.4 && observationalCount > 0) {
    const pctObs = Math.round((observationalCount / totalTrials) * 100)
    // Reconcile the arithmetic: obs + interv may not equal total when
    // some trials have study_type Expanded Access, Other, or null. Add
    // a residual clause when there's a non-zero remainder so the numbers
    // add up on the reader's ledger (r28 audit: 46 obs + 21 interv = 67
    // but stated 68 total, and the missing 1 was study_type=Other).
    const residualClause =
      otherStudyTypeCount > 0
        ? `, and ${otherStudyTypeCount} ${otherStudyTypeCount === 1 ? 'carries' : 'carry'} another study_type designation (Expanded Access, Other, or unlabeled)`
        : ''
    // Phase-labeled subset framing must reflect that interventional
    // trials aren't all phased. If ALL interventional trials are phased
    // (edge case), the split is 1:1 and the clarifying clause can be
    // omitted; otherwise surface the unphased-interventional remainder.
    const phasedSubsetClause =
      interventionalUnphased > 0
        ? `The phase-labeled trials above are the phased subset of the ${interventionalCount} interventional trials; the remaining ${interventionalUnphased} interventional trials carry no phase label.`
        : `The phase-labeled trials above are the ${interventionalCount} interventional trials (all phased).`
    md += `\n*Of the ${totalTrials} linked trials, ${observationalCount} are observational studies (${pctObs}% - biomarker validation, cohort studies, biobank studies), ${interventionalCount} are interventional${residualClause}. Observational trials don't carry Phase 1-4 by design - ClinicalTrials.gov marks them N/A. ${phasedSubsetClause} This shape is expected for topics centered on diagnostics or biomarker discovery; a therapeutics-focused topic would typically show a phase-dominant distribution.*\n`
  }
  md += '\n'

  // Status distribution — surfaces Terminated / Suspended / Withdrawn
  // counts alongside phase so readers can reconcile the narrative's
  // status claims against a visible table. Prior versions surfaced
  // status counts only in prose, leaving a reader with "10 Terminated"
  // and no way to check it.
  if (trials.byStatus && Object.keys(trials.byStatus).length > 0) {
    md += '**By Status**\n\n'
    md += '| Status | Count |\n'
    md += '|--------|-------|\n'
    const statusOrder = [
      'Recruiting',
      'Active Not Recruiting',
      'Enrolling By Invitation',
      'Not Yet Recruiting',
      'Completed',
      'Terminated',
      'Suspended',
      'Withdrawn',
      'Unknown Status',
      'Unknown',
    ]
    Object.entries(trials.byStatus)
      .sort((a, b) => {
        const ai = statusOrder.indexOf(a[0])
        const bi = statusOrder.indexOf(b[0])
        // Unknown positions fall to the end of the sort
        return (ai === -1 ? 100 : ai) - (bi === -1 ? 100 : bi)
      })
      .forEach(([status, count]) => {
        md += `| ${status} | ${count} |\n`
      })
    md += '\n'
  }

  md += '### Active Trials\n\n'
  trials.items.slice(0, 15).forEach((t) => {
    md += `#### ${t.study_title || '(Untitled trial)'}\n`
    md += `- **NCT ID:** [${t.nct_id}](/trial/${t.nct_id})\n`
    // Emit every field with a consistent label; use "Not specified" when
    // the source data is missing so the reader can distinguish "no data"
    // from a rendering oversight. Trial listings previously showed some
    // trials with a "Phase: NA" line and others with no Phase line at
    // all, which read as inconsistent data quality when the underlying
    // issue was just null vs "NA" upstream.
    md += `- **Phase:** ${normalizeTrialField(t.phase)}\n`
    md += `- **Status:** ${normalizeTrialField(t.study_status)}\n`
    md += `- **Sponsor:** ${normalizeTrialField(t.lead_sponsor)}\n`
    md += `- **Conditions:** ${t.conditions?.length ? t.conditions.join(', ') : 'Not specified'}\n`
    md += `- **Enrollment:** ${t.enrollment_count ? `${t.enrollment_count.toLocaleString()} participants` : 'Not specified'}\n`
    md += '\n'
  })

  return md
}

/**
 * Normalize a nullable trial field. Treats null, empty string, and the
 * literal strings "NA"/"N/A" as unspecified so the render is consistent.
 * Some ClinicalTrials.gov entries store "NA" literally in the phase
 * field, while others leave it null — both mean the same thing.
 */
function normalizeTrialField(value: string | null | undefined): string {
  if (!value) return 'Not specified'
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NA' || trimmed.toUpperCase() === 'N/A') {
    return 'Not specified'
  }
  return trimmed
}


function renderOrganizations(orgs: OrgStats[], totalOrgCount?: number): string {
  if (orgs.length === 0) {
    return 'No organization data available.\n'
  }

  // Caption showing "top N of M" when we know the total funded-org
  // count. r33 audit flagged the org table listing ~16 orgs with no
  // "top 16 of 65" label - readers can't tell if the table is complete
  // or a slice.
  const caption =
    typeof totalOrgCount === 'number' && totalOrgCount > orgs.length
      ? `*Top ${orgs.length} of ${totalOrgCount} funded organizations, ranked by NIH funding within the analyzed sample.*\n\n`
      : ''

  // Column headers explicitly say "grant-linked" to distinguish attribution
  // path from raw assignee/sponsor lookup. r23 audit exposed the
  // reconciliation issue: an org can be credited with a patent here (because
  // one of its NIH grants was acknowledged on the patent) while the Patent
  // Activity section shows a different assignee (because assignee reflects
  // whoever owns the patent — often the inventor, a partner institution, or
  // a licensee — which is a different question). Both numbers are correct
  // under different definitions; the label makes that visible.
  let md = caption
  md += '| Organization | Projects | Funding | Pubs (grant-linked) | Trials (grant-linked) | Patents (grant-linked) |\n'
  md += '|--------------|----------|---------|--------------------|-----------------------|------------------------|\n'

  orgs.forEach((o) => {
    const displayName = normalizeOrgName(o.org_name)
    const orgLink = `[${displayName}](/org/${encodeURIComponent(o.org_name)})`
    md += `| ${orgLink} | ${o.projects} | ${formatCurrency(o.funding)} | ${o.publications ?? 0} | ${o.trials} | ${o.patents} |\n`
  })

  md += '\n*Trials, patents, and publications counted here are those where an NIH grant belonging to this org was acknowledged. Patent assignee, trial sponsor, and publication first-author affiliation may differ from the org named on the underlying NIH grant. See the Patent Activity section for a separate view by assignee.*\n'

  return md
}

/**
 * Interpret the sample composition for the reader.
 * Calls out skewed distributions (all precise, all balanced) and small sample warnings.
 */
function renderSampleInterpretation(
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext
): string {
  const total = context.fundingStats.projectCount
  if (total === 0) return ''

  const precise = agentOutputs.projects.items.filter((p) => p.match_tier === 'precise').length
  const balanced = agentOutputs.projects.items.filter((p) => p.match_tier === 'balanced').length
  const preciseRatio = total > 0 ? precise / total : 0

  const notes: string[] = []

  // Skew interpretation
  if (precise === total && total >= 5) {
    notes.push(
      `**All ${total} matches are Precise** (similarity ≥50%). This is not a tuned threshold - it reflects the topic mapping to a tightly-bounded research area where most relevant NIH grants land above the 50% similarity cutoff. Broader topics with less coherent literature produce mixed Precise + Balanced splits (typically 60/40 to 80/20). Note that "Precise" measures semantic similarity to the query, not perfect topical fit - a project can score above the threshold and still touch adjacent research areas (e.g., a project whose main focus is diagnostic biomarkers but whose abstract mentions sepsis biomarkers as comparator work). Treat this signal as "the field's vocabulary aligns well with our query," not as "every project is a pure topic match."`
    )
  } else if (preciseRatio >= 0.7 && total >= 5) {
    notes.push(
      `**${precise} of ${total} matches are Precise** (${Math.round(preciseRatio * 100)}%). The sample skews toward high-relevance results, suggesting the query is well-matched to a coherent research area.`
    )
  } else if (precise === 0 && balanced === total && total >= 5) {
    notes.push(
      `**All ${total} matches are Balanced** (similarity 35-50%). No projects met the Precise threshold — the topic may be broad, multi-disciplinary, or use terminology that diverges from common NIH abstracts. Treat findings as directional rather than definitive.`
    )
  }

  // Small-sample caveats
  if (total < 5) {
    notes.push(
      `**Small sample (${total} projects)**: Statistical patterns are not interpretable at this size. Findings are descriptive of these specific projects rather than the broader field.`
    )
  } else if (total < 10) {
    notes.push(
      `**Modest sample (${total} projects)**: Aggregate metrics (top organizations, category distribution) are based on a small number of projects and should be read as indicative.`
    )
  }

  // Linked-data composition signal
  if (
    agentOutputs.trials.items.length === 0 &&
    agentOutputs.patents.items.length === 0 &&
    agentOutputs.publications.items.length === 0
  ) {
    notes.push(
      `**No linked clinical trials, patents, or publications were found** for these projects. This is consistent with very early-stage research, projects that have not yet produced linked outputs in NIH RePORTER, or topics where outputs flow to non-NIH-tracked channels.`
    )
  }

  if (notes.length === 0) return ''

  return '**Sample Interpretation:**\n\n' + notes.map((n) => `- ${n}`).join('\n') + '\n\n'
}

function renderResearchers(researchers: ResearcherStats[]): string {
  if (researchers.length === 0) {
    return 'No researcher data available.\n'
  }

  let md = '| Researcher | Projects | Funding | Organization |\n'
  md += '|------------|----------|---------|-------------|\n'

  researchers.forEach((r) => {
    const piLink = `[${r.pi_name}](/researcher/${encodeURIComponent(r.pi_name)})`
    md += `| ${piLink} | ${r.projects} | ${formatCurrency(r.funding)} | ${r.org ? normalizeOrgName(r.org) : 'N/A'} |\n`
  })

  return md
}

// --- Formatting helpers ---

/**
 * Format projects with tier indicators for Claude
 */
function formatProjectsWithTiers(projects: ProjectItem[]): string {
  return projects
    .slice(0, 100)
    .map((p, i) => {
      const tier = p.match_tier === 'precise' ? '[PRECISE]' : '[BALANCED]'
      const sim = p.similarity ? ` (${(p.similarity * 100).toFixed(0)}%)` : ''
      return `[${i + 1}] ${tier}${sim} ${p.title}\nPI: ${p.pi_names?.split(';')[0] || 'N/A'} | Org: ${p.org_name || 'N/A'} | ${formatCurrency(p.total_cost || 0)}\n${p.abstract || 'No abstract available'}`
    })
    .join('\n\n---\n\n')
}

/**
 * Compact one-line-per-project listing of the FULL analyzed set — used
 * for prompts that need to reason about presence/absence across the
 * whole sample (gap analysis, cancer-type or disease coverage,
 * methodological gaps). Sending just the top-N with full abstracts
 * caused counting hallucinations: the LLM said "only 1 pancreatic
 * cancer project" when the analyzed set of 123 actually had 8+ with
 * "pancreatic" in the title alone.
 */
/**
 * Compact one-line-per-project listing used as the FULL PROJECT LIST
 * grounding in LLM prompts. Leads with the NIH project_number so the
 * LLM can cite projects by an identifier the reader can look up (a
 * project_number is a clickable / grep-able reference; a bare [N] index
 * is not).
 */
function formatAllProjectsCompact(projects: ProjectItem[]): string {
  return projects
    .map((p) => {
      const pn = p.project_number || p.application_id || '(no ID)'
      return `${pn} | ${p.title || '(no title)'} | ${p.org_name || 'N/A'} | ${p.primary_category || 'N/A'}`
    })
    .join('\n')
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount.toLocaleString()}`
}

/**
 * Rebuild byPhase after the topical relevance filter drops off-topic
 * trials. Original agent output includes ALL trials; the filtered list
 * excludes 'unrelated', and the phase chart / summary should agree with
 * what the reader sees in the Active Trials listing.
 *
 * Uses the same phase normalization as the trials agent so keys are
 * consistent — "PHASE1" and "PHASE 1" collapse to "Phase 1", "NA" and
 * "N/A" collapse to "N/A", etc. Without this the chart splits the same
 * kind of study across multiple bars (r19 audit: "NA":10 vs "N/A":39
 * as separate bars, plus "PHASE1"/"PHASE2" not matching the render
 * sort order that expects "Phase 1"/"Phase 2").
 */
function recomputeTrialsByPhase(trials: TrialItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of trials) {
    const key = normalizeTrialPhase(t.phase, t.study_type)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

/** Duplicates agents/trials.ts::normalizePhase — see that comment. */
function normalizeTrialPhase(phase: string | null, studyType: string | null): string {
  if (!phase) {
    return studyType?.toUpperCase() === 'OBSERVATIONAL' ? 'N/A' : 'Unknown'
  }
  const p = phase.toUpperCase().trim()
  if (p.includes('PHASE1') || p === 'PHASE 1') return 'Phase 1'
  if (p.includes('PHASE2') || p === 'PHASE 2') return 'Phase 2'
  if (p.includes('PHASE3') || p === 'PHASE 3') return 'Phase 3'
  if (p.includes('PHASE4') || p === 'PHASE 4') return 'Phase 4'
  if (p.includes('EARLY')) return 'Early Phase 1'
  if (p === 'NA' || p === 'N/A' || p === '') return 'N/A'
  return phase
}

/**
 * Recompute byStatus from the kept trials — mirrors recomputeTrialsByPhase.
 * Needed because the narrative surfaces status counts ("10 Terminated,
 * 2 Suspended") and the Trial Summary table shows only phase counts,
 * leaving the reader with claims they can't reconcile against what's
 * visible.
 */
function recomputeTrialsByStatus(trials: TrialItem[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of trials) {
    const raw = (t.study_status || 'Unknown').trim()
    // Normalize ClinicalTrials.gov's UPPER_SNAKE_CASE to human-readable
    // form so table + chart labels stay clean.
    const label = raw
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
    counts[label] = (counts[label] || 0) + 1
  }
  return counts
}

/**
 * Rebuild byAssignee after the topical relevance filter drops off-topic
 * patents. Same rationale as recomputeTrialsByPhase.
 */
function recomputePatentsByAssignee(patents: PatentItem[]): Array<{ assignee: string; count: number }> {
  const counts = new Map<string, number>()
  for (const p of patents) {
    if (!p.assignee) continue
    counts.set(p.assignee, (counts.get(p.assignee) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([assignee, count]) => ({ assignee, count }))
    .sort((a, b) => b.count - a.count)
}

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Render the funding-by-year list for prompt context, annotating the
 * partial current FY so the LLM doesn't read it as a real year-over-year decline.
 */
function formatYearTrendForPrompt(byYear: FundingStats['byYear']): string {
  return byYear
    .slice(0, 5)
    .map((y) => `${y.year}: ${formatCurrency(y.funding)}${y.isPartial ? ' (YTD, partial year)' : ''}`)
    .join(', ')
}

/**
 * A reusable critical-instruction block that every funding-trend-consuming
 * prompt includes. Tells the LLM not to interpret the partial FY's lower
 * number as a real funding decline.
 */
function partialFYPromptDirective(stats: FundingStats): string {
  if (!stats.partialFYNote || !stats.currentFY) return ''
  const fy = stats.currentFY
  const priorFY = fy - 1
  return `\n\n## CRITICAL — FY${fy} IS A PARTIAL YEAR
${stats.partialFYNote}
The FY${fy} figure shown is YTD only and reflects partial reporting. Do NOT interpret a drop from FY${priorFY} to FY${fy} as a real funding decline — it is incomplete data. When discussing recent funding trends, either exclude FY${fy} from year-over-year comparisons or explicitly label it as YTD. Never use language like "declined to" or "fell to" for FY${fy}.`
}

// normalizeOrgName, normalizeJournalName, titleCaseToken, ORG_ACRONYMS,
// and ORG_SMALL_WORDS have moved to src/lib/format-names.ts so UI code
// can share the same normalization. Import at top of this file.

/**
 * Clean project narrative/abstract text
 * Removes common prefixes like "PROJECT NARRATIVE", "Narrative", etc.
 * and normalizes whitespace
 */
function cleanNarrative(text: string | null): string | null {
  if (!text) return null

  // Remove common prefix patterns (case insensitive)
  let cleaned = text
    .replace(/^(PROJECT\s+)?NARRATIVE\s*/i, '')
    .replace(/^Project\s+narrative\s*/i, '')
    .replace(/^Narrative\s*/i, '')
    .replace(/^PUBLIC\s+HEALTH\s+RELEVANCE\s*/i, '')
    .replace(/^PHR\s*:\s*/i, '')

  // Normalize whitespace: collapse multiple newlines/spaces into single space
  cleaned = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Remove leading punctuation (colons, dashes, etc.) that might remain after prefix removal
  cleaned = cleaned.replace(/^[:\-–—•\s]+/, '').trim()

  return cleaned
}
