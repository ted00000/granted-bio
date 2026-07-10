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
    markdownContent,
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

## DATA SUMMARY (do NOT repeat these numbers - interpret what they MEAN)
- ${context.fundingStats.projectCount} projects analyzed (${preciseCount} highly relevant, ${balancedCount} relevant)
- ${formatCurrency(context.fundingStats.total)} in funding across ${context.fundingStats.orgCount} organizations
- ${agentOutputs.trials.items.length} clinical trials | ${agentOutputs.patents.items.length} patents
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
  - "genuine scientific opportunity"
  - "perhaps most critically"
  - "underscores"
  - "poised to"
  - "landscape reveals"
  These phrases mark AI-generated prose immediately and destroy credibility.
- **Ban vague qualifiers.** Replace "significantly", "substantially", "meaningfully" with actual numbers or drop the sentence.
- **Frame observations as observations, not verdicts.** "5 of the top 10 orgs are academic" — good. "The field is accelerating" from a two-point FY trend — hedge: "FY2025 funding was higher than FY2024, but a two-point trend is not by itself proof of acceleration."
- **NUMERIC RIGOR — CRITICAL.** Any percentage or share claim you write MUST reconcile to numbers a reader can verify against the tables below. Do NOT say "cfDNA appears in ~70% of projects" when the analyte table shows cfDNA general at 27.6%. If you want to speak to a combined analyte class, sum the specific rows explicitly ("Cell-free DNA analytes broadly — general cfDNA (28%), ctDNA (20%), DNA methylation (12%), fragmentomics (3%) — together represent ~63% of classified projects"). Loose "~70%" claims that don't tie to a specific number in the tables below invite the exact discrediting we've been trying to close.

Three paragraphs, in this order:

**Paragraph 1 - What the data actually shows.** Two or three hardest quantitative facts (funding total + project count + phase distribution + top org concentration). Structure: "Of X projects totaling $YM, Z% cluster around approach A, W trials are in Phase B or later, top P orgs hold Q% of total funding." Concrete.

**Paragraph 2 - Where the interesting cleavages are.** Point at 2-3 concrete positioning observations from the data (specific approaches, specific institutional strategies, specific gaps). Reference actual project numbers or org names. Do NOT abstract to "the field is..." — say "Of the 5 methodological clusters identified, X and Y dominate; Z is present but thin."

**Paragraph 3 - What a ${persona} should take away.** 2-3 concrete watchpoints, not generic advice. Tie each to something specific in the data. For researcher: which grant mechanisms and collaborators to consider given the funded landscape. For investor: what technical/clinical milestones matter and what commercial signals to watch.

OUTPUT FORMAT: Three paragraphs, no headings, no bullet points. Do NOT start with a heading.

SAMPLE-BASED LANGUAGE (still required):
- "Among the projects analyzed..." not "The field has..."
- Prefer "the sample shows" over "the field is"
- Acknowledge NIH-linked scope where it materially affects the reading

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
    return {
      funding: parsed.funding || '',
      clinicalPipeline: parsed.clinicalPipeline || '',
      patents: parsed.patents || '',
      publications: parsed.publications || '',
    }
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate section insights:', error)
    return defaultInsights()
  }
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
  "collaborationSignals": "2-3 sentences with confidence+evidence tags: Are there patterns of collaboration (multi-PI grants, institutional partnerships)? Who might be good collaborators?",
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
- Phase distribution: ${JSON.stringify(trialPhases)}
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

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
Append this exact markdown pattern inline at the end of each substantive claim in maturityNarrative and evidenceSummary fields:

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
  "strategicImplications": "2-3 sentences of persona-appropriate 'so what' advice. For a researcher persona, frame around proposal strategy (what grant mechanisms make sense, what collaborators to pursue, what analytical gaps to fill). For an investor persona, frame around investment thesis (what stage of company to look for, what technical milestones matter, what to diligence). Reference specific numbers from the data.",
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
      strategicImplications: typeof parsed.strategicImplications === 'string' ? parsed.strategicImplications : undefined,
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
  "strategicImplications": "3-4 sentences of persona-appropriate 'so what' advice tied to the cluster landscape"
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
      strategicImplications: typeof parsed.strategicImplications === 'string' ? parsed.strategicImplications : undefined,
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

  const prompt = `Analyze the IP landscape for "${topic}" based on patent data.

READER PERSONA: **${persona}** — tailor the strategicImplications field accordingly.

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

CONFIDENCE + EVIDENCE (REQUIRED FORMAT):
Append this exact markdown pattern inline at the end of each substantive claim in freedomToOperate, recentActivityTrend, and narrative:

  **Confidence: High/Medium/Low** — Evidence: [concrete counts, e.g. "10 patents from 4 assignees, 0 in the last 2 years"]

Confidence scale:
- **High**: pattern rests on ≥15 linked patents across multiple assignees.
- **Medium**: 5-14 linked patents OR clear concentration among 2-3 assignees.
- **Low**: <5 linked patents. Explicitly state that with a small linked sample, the true commercial IP landscape is likely much larger.

STRATEGIC IMPLICATIONS (REQUIRED):
Add a persona-appropriate "so what" paragraph tied to the IP finding. Reader persona is provided at top of prompt. Reference specific counts.

Return JSON only. Do NOT include a list of patent holders — the system
fills that in from the actual byAssignee counts. Only return the
narrative fields below.
{
  "concentration": "fragmented" | "moderately_concentrated" | "highly_concentrated",
  "freedomToOperate": "2-3 sentences with confidence+evidence tags assessing potential FTO concerns based on the NIH-linked sample",
  "recentActivityTrend": "One sentence with confidence+evidence tag on patent activity trend within the linked sample",
  "narrative": "2-3 sentences with confidence+evidence tags on what the linked patent pattern may suggest for commercial development",
  "strategicImplications": "2-3 sentences of persona-appropriate 'so what' advice tied to the IP concentration and activity pattern"
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
    return {
      concentration: parsed.concentration || 'fragmented',
      dominantAssignees: topAssignees.slice(0, 5).map((a) => a.assignee),
      freedomToOperate: normalizeConfidenceTagSpacing(parsed.freedomToOperate || ''),
      recentActivityTrend: normalizeConfidenceTagSpacing(parsed.recentActivityTrend || ''),
      narrative: normalizeConfidenceTagSpacing(parsed.narrative || ''),
      strategicImplications: typeof parsed.strategicImplications === 'string' ? parsed.strategicImplications : undefined,
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

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

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

  const topOrgLine = context.topOrganizations.slice(0, 5).map((o) => `${o.org_name} (${o.projects} projects, ${formatCurrency(o.funding)})`).join('; ')
  const topPILine = context.topResearchers.slice(0, 5).map((r) => `${r.pi_name} (${r.projects} projects, ${formatCurrency(r.funding)})`).join('; ')
  const topOpps = whiteSpace.topOpportunities.slice(0, 4).map((o) => `${o.categoryName} (${o.dimensionName}, sample=${o.sampleCount}, broader NIH=${o.broaderNihCount})`).join('; ')

  const prompt = `Write a persona-specific "Next Steps" checklist for a report on "${topic}".

READER PERSONA: **${persona}**

Reference the report's ACTUAL findings (don't produce generic advice):
- Top orgs by projects: ${topOrgLine || 'none'}
- Top PIs by funding: ${topPILine || 'none'}
- Top white-space opportunities: ${topOpps || 'none'}
- Total projects in analyzed sample: ${agentOutputs.projects.items.length}
- Total NIH funding: ${formatCurrency(context.fundingStats.total)}
- Total trials in sample (post relevance filter): ${agentOutputs.trials.items.length}
- Total patents in sample (post relevance filter): ${agentOutputs.patents.items.length}
- IP concentration: ${ipLandscape.concentration}

Produce a checklist of 6-8 concrete NEXT ACTIONS the reader should take AFTER reading this report. Each item should:
- Be specific to a named org, PI, technology category, or funding pattern from the data
- Point to a concrete action (search, read, contact, apply for)
- Reference where the reader should look (which NIH program, which paper, which company)

Persona guidance:
- **researcher**: proposal strategy, collaborator scouting, methodology gaps to close, grant mechanisms to target (R01, R21, U01, SBIR)
- **investor**: diligence questions, companies to research, technical milestones to watch, market signals to monitor

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
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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

${renderOrganizations(context.topOrganizations)}

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

${renderOrganizations(context.topOrganizations)}

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

  // Render as a proper 3-column table
  md += '### Methodological Clusters\n\n'
  md += '| Approach | Key Players | Maturity | Commercial Readiness |\n'
  md += '|----------|-------------|----------|---------------------|\n'

  topology.clusters.forEach((cluster) => {
    const players = cluster.keyPlayers.slice(0, 4).join(', ')
    const playersDisplay = cluster.keyPlayers.length > 4 ? `${players}, ...` : players
    md += `| **${cluster.approach}** | ${playersDisplay} | ${cluster.maturityLevel} | ${cluster.commercialReadiness} |\n`
  })

  md += '\n'

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
    md += `*Evidence: ${f.evidence}*\n\n`
  })
  return md
}

function renderWhiteSpace(ws: WhiteSpaceAnalysis): string {
  let md = ''

  // Scope caveat first — the reader needs to know what "NIH-funded" means
  // and doesn't mean before interpreting counts.
  md += `*${ws.scopeNote}*\n\n`

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
    md += `| Category | Projects | % of Sample | Funding | ${broaderHeader} |\n`
    md += `|----------|---------:|------------:|--------:|------------:|\n`
    for (const cat of dim.categories) {
      const share = ws.totalProjects > 0 ? (cat.projectCount / ws.totalProjects) * 100 : 0
      const broaderCell = cat.broaderNihCount === -1 ? 'n/a' : cat.broaderNihCount.toLocaleString()
      md += `| ${cat.name} | ${cat.projectCount} | ${share.toFixed(1)}% | $${(cat.fundingTotal / 1_000_000).toFixed(1)}M | ${broaderCell} |\n`
    }
    md += '\n'

    if (dim.narrative) {
      md += `${dim.narrative}\n\n`
    }
  }

  // Ranked opportunities
  if (ws.topOpportunities.length > 0) {
    md += `### Top White Space Opportunities\n\n`
    md += `*Ranked by the strength of the gap signal — categories that are absent or sparse in the topic-focused sample but active in the broader ${ws.broaderNihScopeLabel || 'NIH RePORTER'} portfolio surface first. Ratios are directional at low sample counts.*\n\n`
    ws.topOpportunities.forEach((op, i) => {
      const share = (op.sampleShare * 100).toFixed(1)
      const broader = op.broaderNihCount === -1 ? 'not queried' : op.broaderNihCount.toLocaleString()
      md += `**${i + 1}. ${op.categoryName}** (${op.dimensionName})\n\n`
      md += `- Analyzed sample: **${op.sampleCount}** projects (${share}% of sample)\n`
      md += `- Broader ${ws.broaderNihScopeLabel || 'NIH RePORTER'}: **${broader}** matching projects\n`
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
    md += '### Collaboration Opportunities\n\n'
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
    stats.byCategory.slice(0, 5).forEach((row) => {
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
  const naCount = trials.byPhase['N/A'] || 0
  if (totalTrials > 0 && naCount / totalTrials >= 0.4 && observationalCount > 0) {
    const pctObs = Math.round((observationalCount / totalTrials) * 100)
    md += `\n*Of the ${totalTrials} linked trials, ${observationalCount} are observational studies (${pctObs}% - biomarker validation, cohort studies, biobank studies) and ${interventionalCount} are interventional. Observational trials don't carry Phase 1-4 by design - ClinicalTrials.gov marks them N/A. The phase-labeled trials above are the interventional subset. This shape is expected for topics centered on diagnostics or biomarker discovery; a therapeutics-focused topic would typically show a phase-dominant distribution.*\n`
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


function renderOrganizations(orgs: OrgStats[]): string {
  if (orgs.length === 0) {
    return 'No organization data available.\n'
  }

  // Column headers explicitly say "grant-linked" to distinguish attribution
  // path from raw assignee/sponsor lookup. r23 audit exposed the
  // reconciliation issue: an org can be credited with a patent here (because
  // one of its NIH grants was acknowledged on the patent) while the Patent
  // Activity section shows a different assignee (because assignee reflects
  // whoever owns the patent — often the inventor, a partner institution, or
  // a licensee — which is a different question). Both numbers are correct
  // under different definitions; the label makes that visible.
  let md = '| Organization | Projects | Funding | Pubs (grant-linked) | Trials (grant-linked) | Patents (grant-linked) |\n'
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
      `**All ${total} matches are Precise** (similarity ≥50%). This is not a tuned threshold — it reflects the topic mapping to a tightly-bounded research area where nearly every relevant NIH grant lands well above the 50% similarity cutoff. Broader topics with less coherent literature produce mixed Precise + Balanced splits (typically 60/40 to 80/20). All-Precise is a signal that the search terminology cleanly maps to how researchers in this field describe their work.`
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
 * Normalize spacing around inline **Confidence:** tags in LLM-produced
 * narrative. The prompt asks the LLM to append the tag inline after each
 * substantive claim, but occasionally the model concatenates it directly
 * to the previous word ("viableConfidence:") or omits the bold markers
 * entirely ("viable Confidence:"). Both surface as visible formatting
 * breaks on page. r25 audit called out one instance ("remains
 * viableConfidence: High Evidence:") on page 26.
 *
 * This normalizer:
 *   - Ensures a period+space separator before **Confidence:** when it's
 *     glued to a word char.
 *   - Wraps bare "Confidence: High/Medium/Low" occurrences in ** so the
 *     visual weight is consistent across sections even when the LLM
 *     forgot the markers.
 *   - Ensures a newline before the tag so it renders as its own sentence
 *     in dense-prose sections.
 */
function normalizeConfidenceTagSpacing(text: string): string {
  if (!text) return text
  let out = text
  // Wrap bare "Confidence: High/Medium/Low" (missing ** markers) — check
  // that it's not already wrapped.
  out = out.replace(/(?<!\*\*)\bConfidence:\s*(High|Medium|Low)(?!\*\*)/g, '**Confidence: $1**')
  // Insert punctuation + newline before the tag if glued to a word char.
  // "viable**Confidence: High**" -> "viable. **Confidence: High**"
  out = out.replace(/(\w)(\*\*Confidence:\s*(High|Medium|Low)\*\*)/g, '$1. $2')
  // Also handle punctuation-adjacent (period+immediate tag with no space).
  out = out.replace(/([.!?])(\*\*Confidence:)/g, '$1 $2')
  return out
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
