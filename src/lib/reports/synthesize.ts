// Synthesis Agent
// Combines all agent outputs into a cohesive markdown report

import type {
  AllAgentOutputs,
  ReportData,
  FundingStats,
  OrgStats,
  ResearcherStats,
  ProjectItem,
  TrialItem,
  PatentItem,
  PublicationItem,
  MarketContext,
} from './types'

interface SynthesisContext {
  fundingStats: FundingStats
  topOrganizations: OrgStats[]
  topResearchers: ResearcherStats[]
  dataLimited?: boolean
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
  console.log(`[Synthesis Agent] Generating report for "${topic}"`)

  // Generate executive summary and section insights in parallel
  const [executiveSummary, sectionInsights] = await Promise.all([
    generateExecutiveSummary(topic, agentOutputs, context),
    generateSectionInsights(topic, agentOutputs, context),
  ])

  // Assemble markdown report
  const markdownContent = assembleMarkdown(topic, agentOutputs, context, executiveSummary, sectionInsights)

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
  }
}

/**
 * Generate executive summary using LLM
 */
async function generateExecutiveSummary(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  // Count precise matches for Claude's context
  const preciseCount = agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length
  const balancedCount = agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length

  const trialSummaries = agentOutputs.trials.items
    .slice(0, 25)
    .map((t) => `- ${t.study_title} (${t.phase || 'Phase N/A'}, ${t.study_status || 'Status N/A'}) - ${t.lead_sponsor || 'Sponsor N/A'}`)
    .join('\n')

  const prompt = `You are writing an executive summary for a research intelligence report on "${topic}".

CRITICAL FRAMING: This data represents a CURATED SAMPLE of ${context.fundingStats.projectCount} high-confidence NIH-funded projects (balanced+ match threshold), not the complete population. Use sample-appropriate language.

MATCH QUALITY TIERS:
- PRECISE (similarity ≥0.50): Highly relevant - weight these most heavily
- BALANCED (similarity ≥0.35): Relevant - standard weight
Each project below shows its match tier. Projects are ranked by relevance (most relevant first).

## RESEARCH CONTENT (analyze these abstracts for substantive insights)

${formatProjectsWithTiers(agentOutputs.projects.items)}

## SAMPLE STATISTICS
- Projects Analyzed: ${context.fundingStats.projectCount} (${preciseCount} precise, ${balancedCount} balanced)
- Total Funding: ${formatCurrency(context.fundingStats.total)}
- Organizations: ${context.fundingStats.orgCount} | PIs: ${context.fundingStats.piCount}
- Categories: ${context.fundingStats.byCategory.slice(0, 5).map(c => `${c.category} (${c.projects})`).join(', ')}

## CLINICAL PIPELINE (${agentOutputs.trials.items.length} trials identified)
${trialSummaries || 'No trials identified'}

## MARKET CONTEXT (population-level, from external research)
${agentOutputs.market.context.overview}

${context.dataLimited ? '\nNote: Limited data available for this topic.' : ''}

## YOUR TASK

Analyze the ACTUAL RESEARCH CONTENT above to write a substantive executive summary. Focus on:

1. **What researchers are actually working on**: Key scientific approaches, methodologies, therapeutic targets, mechanisms being explored
2. **Innovation themes**: Novel approaches, emerging techniques, differentiated strategies observed across the projects
3. **Translational potential**: How basic research is progressing toward clinical application, gaps between research and trials
4. **Key players and their focus areas**: Which institutions are leading, what are they specifically contributing
5. **Transformational opportunities**: Where the sample suggests breakthrough potential or unmet needs

LANGUAGE REQUIREMENTS:
- Use "our analysis reveals", "among the examined projects", "the research content shows"
- For market context, you CAN use population-level language
- For sample data, frame as findings from analysis
- Be SPECIFIC about what you learned from the abstracts - don't just restate numbers

Write 4-5 substantive paragraphs with real insights from the research content. Professional, analytical tone.`

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 2500, // Increased for deeper analysis of 50 projects
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

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
  context: SynthesisContext
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
- Use "our analysis reveals", "among the examined projects", "the research content shows"
- AVOID "the field has X total" or other population-level claims
- Be SPECIFIC about what you learned from the abstracts - cite actual approaches, targets, methods observed
- Each insight should be 3-4 sentences with real substance

Return JSON only, no markdown:
{
  "funding": "3-4 sentences analyzing what researchers are actually working on and what the funding patterns reveal about scientific priorities",
  "clinicalPipeline": "3-4 sentences on what conditions are being targeted, intervention types, and progression through clinical development",
  "patents": "3-4 sentences on what innovations are being protected and what this indicates about translational potential",
  "publications": "3-4 sentences on what scientific questions are being addressed and methodological advances observed"
}`

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1500, // Increased for richer section insights
      messages: [{ role: 'user', content: prompt }],
    })

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
 * Assemble the full markdown report
 */
function assembleMarkdown(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext,
  executiveSummary: string,
  insights: SectionInsights
): string {
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  let md = `# ${topic} Research Landscape

**Generated:** ${now}
**Data Sources:** NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed
${context.dataLimited ? '\n**Note:** This report has limited data available for this topic.\n' : ''}

---

## Executive Summary

${executiveSummary}

---

## Market Context

${renderMarketContext(agentOutputs.market.context)}

---

## NIH Funding Landscape

${renderFundingLandscape(context.fundingStats, insights.funding)}

---

## Key Research Projects

${renderProjects(agentOutputs.projects.items.slice(0, 15))}

---

## Clinical Pipeline

${renderClinicalPipeline(agentOutputs.trials, insights.clinicalPipeline)}

---

## Patent Activity

${renderPatents(agentOutputs.patents, insights.patents)}

---

## Publication Trends

${renderPublications(agentOutputs.publications, insights.publications)}

---

## Key Organizations

${renderOrganizations(context.topOrganizations)}

---

## Key Researchers

${renderResearchers(context.topResearchers)}

---

## About This Report

### Methodology

This report analyzes a curated subset of NIH-funded research projects most relevant to **${topic}**. Projects were identified using semantic search (AI-based conceptual matching) and filtered by match quality.

**Match Quality Tiers:**

Projects are scored by semantic similarity to your search topic and classified into tiers:

| Tier | Similarity | Description |
|------|------------|-------------|
| **Precise** | ≥50% | Highly relevant — directly addresses the topic |
| **Balanced** | ≥35% | Relevant — related research with clear connection |

Only Balanced and Precise matches are included in this analysis. This ensures the report focuses on genuinely relevant research rather than tangentially related projects.

**Sample Composition:**

| Metric | Value |
|--------|-------|
| Projects Analyzed | ${context.fundingStats.projectCount.toLocaleString()} |
| Precise Matches | ${agentOutputs.projects.items.filter(p => p.match_tier === 'precise').length} |
| Balanced Matches | ${agentOutputs.projects.items.filter(p => p.match_tier === 'balanced').length} |
| Total Funding | ${formatCurrency(context.fundingStats.total)} |
| Organizations | ${context.fundingStats.orgCount.toLocaleString()} |
| Principal Investigators | ${context.fundingStats.piCount.toLocaleString()} |

**Linked Data:**

Patents, clinical trials, and publications are sourced from the projects above — only items directly linked to these NIH grants are included:

| Data Type | Count | Source |
|-----------|-------|--------|
| Clinical Trials | ${agentOutputs.trials.items.length} | ClinicalTrials.gov (linked to project numbers) |
| Patents | ${agentOutputs.patents.items.length} | USPTO (linked to project numbers) |
| Publications | ${agentOutputs.publications.items.length} | PubMed (linked to project numbers) |

**Data Sources:**

- **NIH RePORTER** — Funded research projects (FY2015-2025)
- **ClinicalTrials.gov** — Clinical studies linked to NIH projects
- **USPTO** — Patents linked to NIH projects
- **PubMed** — Publications linked to NIH projects
- **AI Synthesis** — Market context and executive summary

### Limitations

This analysis focuses on **depth over breadth**. It represents a statistically meaningful sample of the most relevant NIH-funded research, providing detailed insights rather than exhaustive coverage. The data captures publicly-funded academic and institutional research with high confidence, but does not include:

- Privately-funded industry R&D
- International research outside NIH grants
- Projects not semantically related to the search topic

For comprehensive population-level data, consult [NIH RePORTER](https://reporter.nih.gov) directly.

*Data current as of ${now}.*
`

  return md
}

// --- Render functions ---

function renderMarketContext(market: MarketContext): string {
  let md = '### Market Overview\n\n'
  md += market.overview + '\n\n'

  if (market.marketSize) {
    md += `**Market Size:** ${market.marketSize}\n\n`
  }

  if (market.keyPlayers.length > 0) {
    md += '### Key Players\n\n'
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
    md += market.competitiveLandscape + '\n'
  }

  return md
}

function renderFundingLandscape(stats: FundingStats, insight: string): string {
  let md = ''
  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Funding Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Funding | ${formatCurrency(stats.total)} |\n`
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

function renderProjects(projects: ProjectItem[]): string {
  if (projects.length === 0) {
    return 'No projects found for this topic in our database.\n'
  }

  let md = '### Top Funded Projects\n\n'

  projects.forEach((p, i) => {
    md += `#### ${i + 1}. ${p.title}\n`
    md += `- **PI:** ${p.pi_names?.split(';')[0]?.trim() || 'N/A'}`
    if (p.org_name) md += `, ${p.org_name}`
    md += '\n'
    md += `- **Funding:** ${formatCurrency(p.total_cost || 0)}`
    if (p.fiscal_year) md += ` (FY${p.fiscal_year})`
    md += '\n'
    if (p.primary_category) {
      md += `- **Category:** ${formatCategory(p.primary_category)}\n`
    }
    if (p.abstract) {
      const excerpt = p.abstract.substring(0, 300) + (p.abstract.length > 300 ? '...' : '')
      md += `\n> ${excerpt}\n`
    }
    md += `\n[View Project ->](/project/${p.application_id})\n\n`
  })

  return md
}

function renderClinicalPipeline(trials: AllAgentOutputs['trials'], insight: string): string {
  if (trials.items.length === 0) {
    return 'No clinical trials found for this topic in our database.\n'
  }

  let md = ''
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
    return 'No patents found for this topic in our database.\n'
  }

  let md = ''
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
    return 'No publications found for this topic in our database.\n'
  }

  let md = ''
  if (insight) {
    md += insight + '\n\n'
  }
  md += '### Publication Summary\n\n'
  md += '| Metric | Value |\n'
  md += '|--------|-------|\n'
  md += `| Total Publications | ${pubs.items.length} |\n`
  md += `| Unique Journals | ${pubs.byJournal.length} |\n\n`

  if (pubs.byJournal.length > 0) {
    md += '### Top Journals\n\n'
    md += '| Journal | Publications |\n'
    md += '|---------|-------------|\n'
    pubs.byJournal.slice(0, 5).forEach((j) => {
      md += `| ${j.journal} | ${j.count} |\n`
    })
    md += '\n'
  }

  md += '### Recent Publications\n\n'
  pubs.items.slice(0, 15).forEach((p) => {
    md += `#### ${p.publication_title || 'Untitled'}\n`
    md += `- **PMID:** [${p.pmid}](https://pubmed.ncbi.nlm.nih.gov/${p.pmid})\n`
    if (p.journal) md += `- **Journal:** ${p.journal}\n`
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
    const orgLink = `[${o.org_name}](/org/${encodeURIComponent(o.org_name)})`
    md += `| ${orgLink} | ${o.projects} | ${formatCurrency(o.funding)} | ${o.trials} | ${o.patents} |\n`
  })

  return md
}

function renderResearchers(researchers: ResearcherStats[]): string {
  if (researchers.length === 0) {
    return 'No researcher data available.\n'
  }

  let md = '| Researcher | Projects | Funding | Organization |\n'
  md += '|------------|----------|---------|-------------|\n'

  researchers.forEach((r) => {
    const piLink = `[${r.pi_name}](/researcher/${encodeURIComponent(r.pi_name)})`
    md += `| ${piLink} | ${r.projects} | ${formatCurrency(r.funding)} | ${r.org || 'N/A'} |\n`
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
