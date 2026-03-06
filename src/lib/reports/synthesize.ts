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

  const prompt = `You are writing an executive summary for a research intelligence report on "${topic}".

CRITICAL FRAMING: This data represents a CURATED SAMPLE of the most relevant NIH-funded research, not the complete population. You must use sample-appropriate language throughout.

**Sample Data (from our analysis):**
- Projects Analyzed: ${context.fundingStats.projectCount} high-confidence matches
- Total Funding in Sample: ${formatCurrency(context.fundingStats.total)}
- Organizations Represented: ${context.fundingStats.orgCount}
- Principal Investigators: ${context.fundingStats.piCount}
- Top Categories: ${context.fundingStats.byCategory.slice(0, 3).map(c => c.category).join(', ')}

**Linked Clinical Trials:**
- Trials Identified: ${agentOutputs.trials.items.length}
- By Phase: ${JSON.stringify(agentOutputs.trials.byPhase)}

**Linked Patents:**
- Patents Found: ${agentOutputs.patents.items.length}
- Recent (2 years): ${agentOutputs.patents.recentCount}
- Top Assignees: ${agentOutputs.patents.byAssignee.slice(0, 3).map(a => a.assignee).join(', ') || 'N/A'}

**Linked Publications:**
- Publications Found: ${agentOutputs.publications.items.length}
- Top Journals: ${agentOutputs.publications.byJournal.slice(0, 3).map(j => j.journal).join(', ') || 'N/A'}

**Market Context (population-level perspective):**
${agentOutputs.market.context.overview}

${context.dataLimited ? '\nNote: This report has limited data available for this topic.' : ''}

LANGUAGE REQUIREMENTS:
- Use phrases like "our analysis identified", "among the projects analyzed", "within this sample", "the examined projects reveal"
- For market context, you CAN speak in population-level terms (this comes from external research)
- For sample data (projects, trials, patents, pubs), always frame as findings from the analysis
- AVOID language that implies exhaustive coverage like "the field has X projects" or "there are X PIs in the field"
- DO use comparative insights: "the concentration of funding suggests...", "the distribution indicates..."

Write the executive summary (3-5 paragraphs):
1. Opening: Market opportunity and therapeutic context (population-level from market context)
2. Sample Insights: What our analysis of ${context.fundingStats.projectCount} high-confidence projects reveals about research priorities, funding patterns, and key players
3. Clinical Development: Pipeline observations from linked trials
4. Innovation Landscape: Patent and publication patterns observed
5. Strategic Implications: What the sample suggests about field trajectory

Focus on insights and patterns, not just restating numbers. Write in a professional, analytical tone.`

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 1500,
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
 */
async function generateSectionInsights(
  topic: string,
  agentOutputs: AllAgentOutputs,
  context: SynthesisContext
): Promise<SectionInsights> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()

  // Prepare project abstracts summary for context
  const projectAbstracts = agentOutputs.projects.items
    .slice(0, 5)
    .map((p) => p.abstract?.substring(0, 200))
    .filter(Boolean)
    .join('\n---\n')

  // Prepare patent abstracts summary
  const patentAbstracts = agentOutputs.patents.items
    .slice(0, 5)
    .map((p) => p.patent_abstract?.substring(0, 150))
    .filter(Boolean)
    .join('\n---\n')

  // Prepare publication abstracts summary
  const pubAbstracts = agentOutputs.publications.items
    .slice(0, 5)
    .map((p) => p.abstract?.substring(0, 150))
    .filter(Boolean)
    .join('\n---\n')

  const prompt = `You are analyzing research data for "${topic}" to generate section-specific insights for a research intelligence report.

CRITICAL: This data represents a CURATED SAMPLE of the most relevant NIH-funded research, NOT the complete population. Use sample-appropriate language.

**SAMPLE FUNDING DATA (from ${context.fundingStats.projectCount} analyzed projects):**
- Total Funding in Sample: ${formatCurrency(context.fundingStats.total)}
- Organizations Represented: ${context.fundingStats.orgCount}
- PIs Represented: ${context.fundingStats.piCount}
- By Year: ${JSON.stringify(context.fundingStats.byYear.slice(0, 5))}
- By Category: ${JSON.stringify(context.fundingStats.byCategory.slice(0, 5))}
- Top Orgs in Sample: ${context.fundingStats.byOrg.slice(0, 5).map((o) => `${o.org}: ${formatCurrency(o.funding)}`).join(', ')}

Sample Project Abstracts:
${projectAbstracts || 'None available'}

**LINKED CLINICAL TRIALS (${agentOutputs.trials.items.length} identified):**
- By Phase: ${JSON.stringify(agentOutputs.trials.byPhase)}
- By Status: ${JSON.stringify(agentOutputs.trials.byStatus)}
- Top Sponsors: ${agentOutputs.trials.items.slice(0, 5).map((t) => t.lead_sponsor).filter(Boolean).join(', ')}

**LINKED PATENTS (${agentOutputs.patents.items.length} identified):**
- Recent (2yr): ${agentOutputs.patents.recentCount}
- Top Assignees: ${agentOutputs.patents.byAssignee.slice(0, 5).map((a) => `${a.assignee} (${a.count})`).join(', ')}

Sample Patent Abstracts:
${patentAbstracts || 'None available'}

**LINKED PUBLICATIONS (${agentOutputs.publications.items.length} identified):**
- By Journal: ${JSON.stringify(agentOutputs.publications.byJournal.slice(0, 5))}
- By Year: ${JSON.stringify(agentOutputs.publications.byYear.slice(0, 5))}

Sample Publication Abstracts:
${pubAbstracts || 'None available'}

Generate a JSON object with analytical insights for each section. Each insight should be 2-3 sentences.

LANGUAGE REQUIREMENTS:
- Use "among the analyzed projects", "within this sample", "the examined data reveals", "our analysis identified"
- AVOID "the field has X", "there are X in total", or other population-level claims
- Focus on patterns, concentrations, and what the sample suggests about the broader landscape
- Frame comparative observations: "the concentration suggests...", "the distribution indicates..."

CONTEXT: This sample captures publicly-funded academic research with high confidence. It does not include privately-funded industry R&D or international research outside NIH grants.

{
  "funding": "2-3 sentences on funding patterns observed in the sample and what they suggest about research priorities",
  "clinicalPipeline": "2-3 sentences on clinical development patterns among linked trials",
  "patents": "2-3 sentences on IP patterns among linked patents and what they indicate",
  "publications": "2-3 sentences on publication patterns and academic focus areas observed"
}

Return ONLY valid JSON, no markdown formatting.`

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1000,
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

${renderProjects(agentOutputs.projects.items.slice(0, 10))}

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

This report analyzes a curated subset of NIH-funded research projects most relevant to **${topic}**. Projects were identified using semantic search (AI-based conceptual matching) combined with keyword search, then filtered to include only high-confidence matches based on similarity scoring.

**Sample Composition:**

| Metric | Value |
|--------|-------|
| Projects Analyzed | ${context.fundingStats.projectCount.toLocaleString()} |
| Total Funding | ${formatCurrency(context.fundingStats.total)} |
| Organizations | ${context.fundingStats.orgCount.toLocaleString()} |
| Principal Investigators | ${context.fundingStats.piCount.toLocaleString()} |
| Clinical Trials | ${agentOutputs.trials.items.length} |
| Patents | ${agentOutputs.patents.items.length} |
| Publications | ${agentOutputs.publications.items.length} |

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
  trials.items.slice(0, 10).forEach((t) => {
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
  pubs.items.slice(0, 10).forEach((p) => {
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
