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
} from './types'
import { logApiUsage } from '@/lib/billing/usage'

interface SynthesisContext {
  userId: string
  fundingStats: FundingStats
  topOrganizations: OrgStats[]
  topResearchers: ResearcherStats[]
  dataLimited?: boolean
  persona?: ReportPersona
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

  // Generate all LLM content in parallel (first batch)
  const [executiveSummary, sectionInsights, signalsAnalysis, curatedPublications, enhancedMarketContext, fieldMaturity, competitiveTopology, ipLandscape] = await Promise.all([
    generateExecutiveSummary(topic, agentOutputs, context, usageTracker),
    generateSectionInsights(topic, agentOutputs, context, usageTracker),
    generateSignalsAnalysis(topic, agentOutputs, context, usageTracker),
    generateCuratedPublications(topic, agentOutputs, context, usageTracker),
    enhanceMarketContext(topic, agentOutputs.market.context, context, usageTracker),
    generateFieldMaturityAssessment(topic, agentOutputs, context, usageTracker),
    generateCompetitiveTopology(topic, agentOutputs, context, usageTracker),
    generateIPLandscapeAssessment(topic, agentOutputs, context, usageTracker),
  ])

  // Generate project insights (needs executive summary first for context)
  const projectInsights = await generateProjectInsights(
    topic,
    agentOutputs.projects.items.slice(0, 10),
    executiveSummary,
    context,
    usageTracker
  )

  // Replace raw market context with enhanced version
  agentOutputs.market.context = enhancedMarketContext

  // Assemble markdown report with persona-aware structure
  const markdownContent = assembleMarkdown(topic, agentOutputs, context, executiveSummary, sectionInsights, signalsAnalysis, curatedPublications, fieldMaturity, competitiveTopology, ipLandscape, projectInsights)

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
    fieldMaturity,
    competitiveTopology,
    ipLandscape,
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

## DATA SUMMARY (do NOT repeat these numbers - interpret what they MEAN)
- ${context.fundingStats.projectCount} projects analyzed (${preciseCount} highly relevant, ${balancedCount} relevant)
- ${formatCurrency(context.fundingStats.total)} in funding across ${context.fundingStats.orgCount} organizations
- ${agentOutputs.trials.items.length} clinical trials | ${agentOutputs.patents.items.length} patents
- Dominant category: ${formatCategory(topCategory)}

## RESEARCH ABSTRACTS (scan for patterns, don't describe individual projects)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 30))}

## CLINICAL DEVELOPMENT
${trialSummaries || 'No trials identified'}

## IP ACTIVITY
${patentSummaries || 'No patents identified'}

## MARKET CONTEXT
${agentOutputs.market.context.overview}

---

## YOUR TASK: Write a 3-4 paragraph STRATEGIC executive summary

DO NOT repeat statistics from the body - those appear later in the report.

Instead, answer these questions in narrative form:

1. **Opportunity Signal** (1-2 sentences): What does this research landscape reveal about ${persona === 'investor' ? 'commercial/translational opportunity' : 'scientific opportunity and positioning'}?

2. **Competitive Positioning** (2-3 sentences): Who are the leaders and what differentiates their approaches? Where are the gaps or white spaces?

3. **Momentum Indicators** (2-3 sentences): Is this field accelerating, maturing, or stalling? What evidence supports this from funding trends, trial progression, or publication patterns?

4. **Key ${persona === 'investor' ? 'Risks/Opportunities' : 'Strategic Considerations'}** (2-3 sentences): What should a ${persona} watch for or prioritize?

Write in confident, analytical prose. Be specific about what you observed but don't repeat raw numbers.

OUTPUT FORMAT: Write paragraphs only. Do NOT include any heading at the start of your output (no "## Strategic Executive Summary" or similar) — the section header is added separately.

SAMPLE-BASED LANGUAGE: This analysis covers NIH-linked research, not the complete market. Use confident but appropriately hedged language:
- "Among the projects analyzed..." not "The field has..."
- "This pattern suggests..." or "These findings indicate..."
- "The data shows strong correlation with..." or "appears likely based on..."
- Avoid definitive claims; prefer "may indicate", "suggests", "the sample reveals"

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.`

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

CRITICAL FRAMING: This data represents a CURATED SAMPLE of ${context.fundingStats.projectCount} high-confidence NIH-funded projects (balanced+ match threshold), not the complete population. Use sample-appropriate language.

MATCH QUALITY TIERS:
- [PRECISE] (similarity ≥50%): Highly relevant to "${topic}" - weight these most heavily
- [BALANCED] (similarity ≥35%): Relevant - standard weight
Projects are ranked by relevance. Give more emphasis to insights from [PRECISE] and early-numbered projects.

---

## PROJECT ABSTRACTS (analyze for funding insight)

${formatProjectsWithTiers(agentOutputs.projects.items) || 'No project abstracts available'}

**Sample Statistics:**
- Projects: ${context.fundingStats.projectCount} (${agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length} precise, ${agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length} balanced)
- Total Funding in Sample: ${formatCurrency(context.fundingStats.total)}
- Organizations: ${context.fundingStats.orgCount} | PIs: ${context.fundingStats.piCount}
- Top Categories: ${context.fundingStats.byCategory.slice(0, 3).map(c => `${c.category.replace(/_/g, ' ')} (${c.projects})`).join(', ')}
- Top Orgs: ${context.fundingStats.byOrg.slice(0, 3).map((o) => `${o.org}: ${formatCurrency(o.funding)}`).join(', ')}

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

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

Return JSON only, no markdown:
{
  "funding": "3-4 sentences analyzing what researchers are actually working on and what the funding patterns reveal about scientific priorities",
  "clinicalPipeline": "3-4 sentences on what conditions are being targeted, intervention types, and progression through clinical development",
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

    const parsed = JSON.parse(textContent.text)
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

  const yearTrend = context.fundingStats.byYear
    .slice(0, 5)
    .map((y) => `${y.year}: ${formatCurrency(y.funding)}`)
    .join(', ')

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

## PROJECT ABSTRACTS (sample for technology assessment)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 20))}

---

Generate INVESTOR-FOCUSED signals analysis.

SAMPLE-BASED LANGUAGE: This covers NIH-linked data only, not complete market IP/trials. Use confident but hedged language:
- "Among the linked patents..." not "The IP landscape is..."
- "This pattern suggests..." or "The concentration may indicate..."
- "Based on the NIH sample, freedom to operate appears..." not definitive FTO claims
- Acknowledge limitations while providing actionable insight

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

Return JSON only:

{
  "trlAssessment": "2-3 sentences: Assess technology readiness. What percentage appears early-stage vs. clinical-ready? Are there clear paths to product?",
  "commercialReadiness": "2-3 sentences: How close to market? What's missing for commercialization? Any existing products?",
  "ipConcentration": "2-3 sentences: Who owns the IP landscape? Is it fragmented or concentrated? Freedom to operate concerns?",
  "riskFactors": {
    "scientific": "One sentence describing key scientific/technical risk (or null if none)",
    "regulatory": "One sentence describing regulatory pathway risk (or null if none)",
    "competitive": "One sentence describing competitive/market timing risk (or null if none)",
    "execution": "One sentence describing execution/team/capability risk (or null if none)",
    "overall": "One sentence summary of the most critical risk for investors"
  },
  "comparables": "2-3 sentences: What comparable technologies or companies exist? How have similar investments performed?"
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

## PROJECT ABSTRACTS (analyze for positioning)
${formatProjectsWithTiers(agentOutputs.projects.items.slice(0, 25))}

---

Generate RESEARCHER-FOCUSED signals analysis.

SAMPLE-BASED LANGUAGE: This covers NIH-funded research, not all activity in this space. Use confident but hedged language:
- "Among the funded projects..." not "The field is..."
- "This pattern suggests..." or "The funding distribution indicates..."
- "Based on this sample, gaps may exist in..." not definitive claims
- Acknowledge this represents publicly-funded academic research primarily

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

Return JSON only:

{
  "positioningMap": "2-3 sentences: What distinct approaches exist in this space? How might a new entrant differentiate?",
  "collaborationSignals": "2-3 sentences: Are there patterns of collaboration (multi-PI grants, institutional partnerships)? Who might be good collaborators?",
  "methodologicalTrends": "2-3 sentences: What techniques are emerging vs. mature? What methodological gaps exist?",
  "gapAnalysis": "2-3 sentences: What's NOT being funded or studied? Where are the white spaces?"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
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
        gapAnalysis: '',
        trlAssessment: parsed.trlAssessment || '',
        commercialReadiness: parsed.commercialReadiness || '',
        ipConcentration: parsed.ipConcentration || '',
        riskFactors: parsed.riskFactors || '',
        comparables: parsed.comparables || '',
      }
    } else {
      return {
        positioningMap: parsed.positioningMap || '',
        collaborationSignals: parsed.collaborationSignals || '',
        methodologicalTrends: parsed.methodologicalTrends || '',
        gapAnalysis: parsed.gapAnalysis || '',
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
    gapAnalysis: '',
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
  const yearTrend = context.fundingStats.byYear.slice(0, 3).map(y => `${y.year}: ${formatCurrency(y.funding)}`).join(', ')

  const prompt = `You are integrating market research with NIH funding data for "${topic}".

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

Return JSON only (array of 3-5 items):
[
  {
    "pmid": "12345678",
    "title": "Paper title",
    "journal": "Journal Name",
    "year": 2024,
    "significance": "1-2 sentences on why this paper matters for the field",
    "keyFinding": "One sentence key takeaway"
  }
]`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    // Track usage
    usageTracker.inputTokens += response.usage.input_tokens
    usageTracker.outputTokens += response.usage.output_tokens

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return []
    }

    // Parse JSON from response (handle markdown code blocks)
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '').trim()
    }

    const parsed = JSON.parse(jsonText)
    return Array.isArray(parsed) ? parsed : []
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

  const prompt = `Assess the FIELD MATURITY / TECHNOLOGY READINESS for "${topic}" based on these quantitative signals:

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

Return JSON only:
{
  "trlEstimate": "TRL X-Y" or narrative like "Early Research (TRL 1-3)",
  "maturityNarrative": "2-3 sentences explaining the overall maturity assessment and what it means for someone entering this space",
  "evidenceSummary": {
    "preprintRatio": "One sentence interpreting the preprint ratio — apply small-N rule above when totalPubs < 10",
    "trialProgression": "One sentence interpreting the trial phase distribution — apply small-N rule above when totalTrials < 3",
    "patentActivity": "One sentence interpreting the patent recency — apply small-N rule above when totalPatents < 5"
  },
  "overallAssessment": "nascent" | "emerging" | "maturing" | "established"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
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
      maturityNarrative: parsed.maturityNarrative || '',
      evidenceSummary: {
        preprintRatio: parsed.evidenceSummary?.preprintRatio || '',
        trialProgression: parsed.evidenceSummary?.trialProgression || '',
        patentActivity: parsed.evidenceSummary?.patentActivity || '',
      },
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

Your task: Identify 3-5 DISTINCT METHODOLOGICAL APPROACHES or technology clusters, NOT organizational groupings.

## PROJECT ABSTRACTS
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

SAMPLE-BASED LANGUAGE: This analysis covers NIH-funded academic research. Use hedged language:
- "Among the funded projects, distinct approaches include..."
- "Based on the sample, key academic players appear to be..."
- Commercial players may exist outside NIH-linked data; acknowledge this limitation

FORMATTING: Do NOT use em dashes (—). Use regular hyphens (-) or rewrite sentences to avoid them.

Return JSON only:
{
  "clusters": [
    {
      "approach": "Name of the methodological approach",
      "keyPlayers": ["Stanford", "MIT", "Company X"],
      "maturityLevel": "Emerging",
      "commercialReadiness": "One sentence on commercialization status"
    }
  ],
  "narrative": "2-3 sentences synthesizing the competitive topology - what are the main competing approaches and how do they relate?"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
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

    const parsed = JSON.parse(jsonMatch[0])
    return {
      clusters: Array.isArray(parsed.clusters) ? parsed.clusters : [],
      narrative: parsed.narrative || '',
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
  _context: SynthesisContext,
  usageTracker: UsageTracker
): Promise<IPLandscapeAssessment> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

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

Return JSON only:
{
  "concentration": "fragmented" | "moderately_concentrated" | "highly_concentrated",
  "dominantAssignees": ["Top 3-5 patent holders among linked patents"],
  "freedomToOperate": "2-3 sentences assessing potential FTO concerns based on the NIH-linked sample",
  "recentActivityTrend": "One sentence on patent activity trend within the linked sample",
  "narrative": "2-3 sentences on what the linked patent pattern may suggest for commercial development"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
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
    return {
      concentration: parsed.concentration || 'fragmented',
      dominantAssignees: Array.isArray(parsed.dominantAssignees) ? parsed.dominantAssignees : [],
      freedomToOperate: parsed.freedomToOperate || '',
      recentActivityTrend: parsed.recentActivityTrend || '',
      narrative: parsed.narrative || '',
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
    return parsed
  } catch (error) {
    console.warn('[Synthesis Agent] Failed to generate project insights:', error)
    return {}
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
  projectInsights?: Record<string, string>
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

## Executive Summary

${executiveSummary}

---

## Field Maturity Assessment

${renderFieldMaturity(fieldMaturity)}

---

## Competitive Topology

${renderCompetitiveTopology(competitiveTopology)}

---

`

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

${renderProjects(agentOutputs.projects.items.slice(0, 10), projectInsights)}

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

${renderCuratedPublications(curatedPublications, agentOutputs.publications)}

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

${renderProjects(agentOutputs.projects.items.slice(0, 10), projectInsights)}

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

${renderPatents(agentOutputs.patents, insights.patents)}

---

## Key Publications

${renderCuratedPublications(curatedPublications, agentOutputs.publications)}

---

## Key Organizations

${renderOrganizations(context.topOrganizations)}

---

## Key Researchers

${renderResearchers(context.topResearchers)}

---

`
  }

  // METHODOLOGY (same for both personas)
  md += `## About This Report

### Methodology

This report analyzes a curated subset of NIH-funded research projects most relevant to **${topic}**. Projects were identified using semantic search (AI-based conceptual matching) and filtered by match quality.

**Important Note on Funding Figures:** All funding amounts shown represent the most recent fiscal year award for each project, NOT the total project cost across all years. Multi-year projects will have higher cumulative funding than the FY award shown.

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
| Total FY Awards | ${formatCurrency(context.fundingStats.total)} |
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

  return md || 'Field maturity assessment not available.\n'
}

function renderCompetitiveTopology(topology: CompetitiveTopology): string {
  if (topology.clusters.length === 0) {
    return 'Competitive topology analysis not available.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: Key players listed below are derived from NIH-funded project data and represent academic/research institutions. Commercial entities may not appear.*\n\n'

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

  return md
}

function renderIPLandscape(landscape: IPLandscapeAssessment, patents: AllAgentOutputs['patents'], insight: string): string {
  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only patents linked to NIH-funded projects. Commercial patents and international filings may exist outside this sample.*\n\n'

  // Add the strategic IP assessment first
  const concentrationLabels: Record<string, string> = {
    fragmented: 'Fragmented - Many players, no dominant owner',
    moderately_concentrated: 'Moderately Concentrated - Several key players',
    highly_concentrated: 'Highly Concentrated - Few dominant owners',
  }

  md += `**IP Concentration:** ${concentrationLabels[landscape.concentration] || landscape.concentration}\n\n`

  if (landscape.dominantAssignees.length > 0) {
    md += `**Dominant Patent Holders:** ${landscape.dominantAssignees.join(', ')}\n\n`
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

  // Then add the standard patent section with insight and details
  if (insight) {
    md += '### Patent Analysis\n\n'
    md += insight + '\n\n'
  }

  md += '### Patent Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Patents | ${patents.items.length} |\n`
  md += `| Unique Assignees | ${patents.byAssignee.length} |\n`
  md += `| Recent (2 years) | ${patents.recentCount} |\n\n`

  if (patents.items.length > 0) {
    md += '### Key Patents\n\n'
    patents.items.slice(0, 10).forEach((p) => {
      md += `#### ${p.patent_title || 'Untitled Patent'}\n`
      md += `- **Patent #:** [${p.patent_id}](/patent/${p.patent_id})\n`
      if (p.assignee) md += `- **Assignee:** ${p.assignee}\n`
      if (p.patent_date) md += `- **Date:** ${p.patent_date}\n`
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

  if (signals.gapAnalysis) {
    md += '### Gap Analysis\n\n'
    md += signals.gapAnalysis + '\n\n'
  }

  return md || 'Research positioning analysis not available.\n'
}

function renderCuratedPublications(curated: CuratedPublication[], allPubs: AllAgentOutputs['publications']): string {
  if (curated.length === 0 && allPubs.items.length === 0) {
    return '*Note: This analysis includes only publications linked to NIH-funded projects.*\n\nNo publications found linked to NIH projects in this space.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only publications linked to NIH-funded projects and may not represent the complete body of literature in this field.*\n\n'

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
    md += `- Unique journals: ${allPubs.byJournal.length}\n\n`

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
    md += `**Market Size:** ${market.marketSize}\n\n`
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
  md += '*Amounts reflect most recent fiscal year awards per project.*\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total FY Awards | ${formatCurrency(stats.total)} |\n`
  md += `| Active Projects | ${stats.projectCount.toLocaleString()} |\n`
  md += `| Funding Organizations | ${stats.orgCount.toLocaleString()} |\n`
  md += `| Principal Investigators | ${stats.piCount.toLocaleString()} |\n\n`

  if (stats.byYear.length > 0) {
    md += '### Funding by Year\n\n'
    md += '| Year | Projects | Funding |\n'
    md += '|------|----------|--------|\n'
    stats.byYear.slice(0, 10).forEach((row) => {
      md += `| ${row.year} | ${row.projects} | ${formatCurrency(row.funding)} |\n`
    })
    md += '\n'
  }

  if (stats.byCategory.length > 0) {
    md += '### Top Funding Categories\n\n'
    md += '| Category | Projects | Funding |\n'
    md += '|----------|----------|--------|\n'
    stats.byCategory.slice(0, 5).forEach((row) => {
      md += `| ${formatCategory(row.category)} | ${row.projects} | ${formatCurrency(row.funding)} |\n`
    })
    md += '\n'
  }

  return md
}

function renderProjects(projects: ProjectItem[], projectInsights?: Record<string, string>): string {
  if (projects.length === 0) {
    return 'No projects found for this topic in our database.\n'
  }

  let md = '### Top Funded Projects\n\n'
  md += '*Note: Funding figures shown are the most recent fiscal year award, not total project cost across all years.*\n\n'

  projects.forEach((p, i) => {
    md += `#### ${i + 1}. ${p.title}\n`
    md += `- **PI:** ${p.pi_names?.split(';')[0]?.trim() || 'N/A'}`
    if (p.org_name) md += `, ${normalizeOrgName(p.org_name)}`
    md += '\n'
    md += `- **FY Award:** ${formatCurrency(p.total_cost || 0)}`
    if (p.fiscal_year) md += ` (FY${p.fiscal_year})`
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
  md += '\n'

  md += '### Active Trials\n\n'
  trials.items.slice(0, 15).forEach((t) => {
    md += `#### ${t.study_title}\n`
    md += `- **NCT ID:** [${t.nct_id}](/trial/${t.nct_id})\n`
    if (t.phase) md += `- **Phase:** ${t.phase}\n`
    if (t.study_status) md += `- **Status:** ${t.study_status}\n`
    if (t.lead_sponsor) md += `- **Sponsor:** ${t.lead_sponsor}\n`
    if (t.conditions?.length) md += `- **Conditions:** ${t.conditions.join(', ')}\n`
    if (t.enrollment_count) md += `- **Enrollment:** ${t.enrollment_count.toLocaleString()} participants\n`
    md += '\n'
  })

  return md
}

function renderPatents(patents: AllAgentOutputs['patents'], insight: string): string {
  if (patents.items.length === 0) {
    return '*Note: This analysis includes only patents linked to NIH-funded projects.*\n\nNo patents found linked to NIH projects in this space.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only patents linked to NIH-funded projects. Commercial patents and international filings may exist outside this sample.*\n\n'

  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Patent Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Patents | ${patents.items.length} |\n`
  md += `| Unique Assignees | ${patents.byAssignee.length} |\n`
  md += `| Recent (2 years) | ${patents.recentCount} |\n\n`

  md += '### Key Patents\n\n'
  patents.items.slice(0, 15).forEach((p) => {
    md += `#### ${p.patent_title || 'Untitled Patent'}\n`
    md += `- **Patent #:** [${p.patent_id}](/patent/${p.patent_id})\n`
    if (p.assignee) md += `- **Assignee:** ${p.assignee}\n`
    if (p.patent_date) md += `- **Date:** ${p.patent_date}\n`
    if (p.patent_abstract) {
      const excerpt = p.patent_abstract.substring(0, 200) + (p.patent_abstract.length > 200 ? '...' : '')
      md += `\n> ${excerpt}\n`
    }
    md += '\n'
  })

  return md
}

function renderPublications(pubs: AllAgentOutputs['publications'], insight: string): string {
  if (pubs.items.length === 0) {
    return '*Note: This analysis includes only publications linked to NIH-funded projects.*\n\nNo publications found linked to NIH projects in this space.\n'
  }

  let md = ''

  // Disclaimer about NIH-linked sample
  md += '*Note: This analysis includes only publications linked to NIH-funded projects and may not represent the complete body of literature in this field.*\n\n'

  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Publication Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Publications | ${pubs.items.length} |\n`
  md += `| Unique Journals | ${pubs.byJournal.length} |\n\n`

  // Only show "Top Journals" list if at least one journal has 2+ pubs
  const topJournalCount = pubs.byJournal[0]?.count ?? 0
  if (pubs.byJournal.length > 0 && topJournalCount >= 2) {
    md += '### Top Journals\n\n'
    md += '| Journal | Publications |\n'
    md += '|---------|-------------|\n'
    pubs.byJournal
      .filter((j) => j.count >= 2)
      .slice(0, 5)
      .forEach((j) => {
        md += `| ${normalizeJournalName(j.journal)} | ${j.count} |\n`
      })
    md += '\n'
  }

  md += '### Recent Publications\n\n'
  pubs.items.slice(0, 15).forEach((p) => {
    md += `#### ${p.publication_title || 'Untitled'}\n`
    md += `- **PMID:** [${p.pmid}](https://pubmed.ncbi.nlm.nih.gov/${p.pmid})\n`
    if (p.journal) md += `- **Journal:** ${normalizeJournalName(p.journal)}\n`
    if (p.publication_date) md += `- **Year:** ${new Date(p.publication_date).getFullYear()}\n`
    if (p.authors) md += `- **Authors:** ${p.authors}\n`
    md += '\n'
  })

  return md
}

function renderOrganizations(orgs: OrgStats[]): string {
  if (orgs.length === 0) {
    return 'No organization data available.\n'
  }

  let md = '| Organization | Projects | Funding | Trials | Patents |\n'
  md += '|--------------|----------|---------|--------|--------|\n'

  orgs.forEach((o) => {
    const displayName = normalizeOrgName(o.org_name)
    const orgLink = `[${displayName}](/org/${encodeURIComponent(o.org_name)})`
    md += `| ${orgLink} | ${o.projects} | ${formatCurrency(o.funding)} | ${o.trials} | ${o.patents} |\n`
  })

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
      `**All ${total} matches are Precise** (similarity ≥50%). This indicates strong topical convergence — the search query maps cleanly to a well-defined research area, and confidence in sample relevance is high.`
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

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`
  return `$${amount.toLocaleString()}`
}

function formatCategory(category: string): string {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Acronyms that should stay all-caps in org/journal names
const ORG_ACRONYMS = new Set([
  'NIH', 'NSF', 'MIT', 'UCLA', 'USC', 'UCSF', 'UCSD', 'UCSB', 'UCB', 'UNC',
  'UCD', 'UCI', 'UCR', 'CSU', 'CMU', 'UC', 'IBM', 'HHMI', 'ASU', 'SUNY',
  'CUNY', 'NYU', 'LLC', 'PC', 'CRO', 'CDMO', 'USA', 'UK', 'BIDMC', 'MGH',
  'CHOP', 'CSHL', 'NIST', 'EPA', 'FDA', 'CDC', 'DOE', 'DARPA', 'OHSU',
  'MD', 'PhD', 'DDS', 'DVM', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI',
  'XII', 'PLOS', 'EMBO', 'JCI', 'NEJM', 'BMJ', 'JAMA', 'PNAS', 'EBO',
])

const ORG_SMALL_WORDS = new Set([
  'of', 'the', 'and', 'in', 'for', 'on', 'at', 'to', 'a', 'an', 'or', 'as',
  'by', 'with', 'from', 'de', 'la', 'le', 'du',
])

// Journals with intentional non-standard casing — substitute after title-casing
const JOURNAL_CASE_FIXES: Array<[RegExp, string]> = [
  [/\bBiorxiv\b/g, 'bioRxiv'],
  [/\bMedrxiv\b/g, 'medRxiv'],
  [/\bArxiv\b/g, 'arXiv'],
  [/\bMbio\b/g, 'mBio'],
  [/\bElife\b/g, 'eLife'],
  [/\bPlos\b/g, 'PLOS'],
  [/\bEmbo\b/g, 'EMBO'],
  [/\bJci\b/g, 'JCI'],
  [/\bNejm\b/g, 'NEJM'],
  [/\bBmj\b/g, 'BMJ'],
  [/\bJama\b/g, 'JAMA'],
  [/\bPnas\b/g, 'PNAS'],
  [/\bIscience\b/g, 'iScience'],
]

/**
 * Title-case a single token, preserving internal hyphens and acronyms
 */
function titleCaseToken(token: string): string {
  return token.split('-').map(part => {
    const alpha = part.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha)) return part
    let result = ''
    let firstLetterDone = false
    for (const c of part) {
      if (/[A-Za-z]/.test(c)) {
        if (!firstLetterDone) {
          result += c.toUpperCase()
          firstLetterDone = true
        } else {
          result += c.toLowerCase()
        }
      } else {
        result += c
      }
    }
    return result
  }).join('-')
}

/**
 * Normalize an organization name from NIH RePORTER data:
 * - Strips trailing extra closing parens (data quirk: "X (Y))")
 * - Title-cases all-caps strings (e.g. "STANFORD UNIVERSITY" → "Stanford University")
 * - Preserves known acronyms (MIT, UCLA, NIH)
 * - Lowercases small connector words (of, the, and)
 * - Leaves already-mixed-case names alone
 */
function normalizeOrgName(name: string | null | undefined): string {
  if (!name) return ''
  let cleaned = name.trim()
  // Strip trailing extra closing parens
  cleaned = cleaned.replace(/\){2,}$/, ')')
  // Skip if already mixed case (likely an already-normalized commercial name)
  if (/[a-z]/.test(cleaned)) return cleaned

  const tokens = cleaned.split(/(\s+)/)
  let firstNonSpaceFound = false

  return tokens.map(token => {
    if (/^\s+$/.test(token) || !token) return token
    const isFirst = !firstNonSpaceFound
    firstNonSpaceFound = true

    const alpha = token.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha)) return token
    if (!isFirst && ORG_SMALL_WORDS.has(alpha.toLowerCase())) {
      return token.toLowerCase()
    }
    return titleCaseToken(token)
  }).join('')
}

/**
 * Title-case a journal name and apply known special-case fixes (bioRxiv, PLOS, etc.)
 * Always normalizes regardless of input casing, since PubMed feeds inconsistently cased journals.
 */
function normalizeJournalName(name: string | null | undefined): string {
  if (!name) return ''
  const trimmed = name.trim()
  if (!trimmed) return ''

  const tokens = trimmed.split(/(\s+)/)
  let firstNonSpaceFound = false

  let result = tokens.map(token => {
    if (/^\s+$/.test(token) || !token) return token
    const isFirst = !firstNonSpaceFound
    firstNonSpaceFound = true

    const alpha = token.replace(/[^A-Za-z]/g, '')
    if (ORG_ACRONYMS.has(alpha.toUpperCase()) && alpha === alpha.toUpperCase()) return token
    if (!isFirst && ORG_SMALL_WORDS.has(alpha.toLowerCase())) {
      return token.toLowerCase()
    }
    return titleCaseToken(token)
  }).join('')

  // Apply special-case fixes for known mixed-case journals
  for (const [pattern, replacement] of JOURNAL_CASE_FIXES) {
    result = result.replace(pattern, replacement)
  }
  return result
}

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
