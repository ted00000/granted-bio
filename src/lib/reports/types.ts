// Types for Intelligence Reports feature

export type ReportType = 'topic' | 'portfolio'
export type ReportStatus = 'generating' | 'complete' | 'failed'
export type ReportPersona = 'researcher' | 'investor'

export interface ReportMetadata {
  id: string
  user_id: string
  title: string
  report_type: ReportType
  topic: string | null
  status: ReportStatus
  data_limited: boolean
  project_count: number | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface FundingStats {
  total: number
  projectCount: number
  orgCount: number
  piCount: number
  /**
   * Funding aggregated by NIH fiscal year. Each entry sums total_cost across
   * all matching budget-period rows for that year (NOT just the latest
   * budget period per project — which is what we show on individual project
   * cards). isPartial = true when the year hasn't ended at report time.
   */
  byYear: Array<{ year: number; projects: number; funding: number; isPartial?: boolean }>
  byCategory: Array<{ category: string; projects: number; funding: number }>
  byOrg: Array<{ org: string; projects: number; funding: number }>
  /** Current NIH fiscal year at report-generation time. */
  currentFY?: number
  /** Footnote text for the partial current FY (e.g. "Through May 2026; FY2026 ends Sep 30, 2026."). */
  partialFYNote?: string
}

export interface ProjectItem {
  application_id: string
  project_number: string | null
  title: string
  abstract: string | null
  pi_names: string | null
  org_name: string | null
  total_cost: number | null
  fiscal_year: number | null
  primary_category: string | null
  similarity: number | null  // Semantic similarity score (0-1)
  match_tier: 'precise' | 'balanced' | 'broad' | null  // Match quality tier
}

export interface TrialItem {
  nct_id: string
  study_title: string
  phase: string | null
  study_type: string | null
  study_status: string | null
  lead_sponsor: string | null
  conditions: string[] | null
  enrollment_count: number | null
  /**
   * NIH project_numbers this trial is linked to via clinical_studies.
   * Empty for semantic-only matches (Path 2) where the trial has no
   * NIH grant linkage. Used by Key Organizations rollup to attribute
   * trials to the funded org rather than to the trial's listed sponsor
   * (which is a different string and won't match across sources).
   */
  project_numbers: string[]
}

export interface PatentItem {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  assignee: string | null
  patent_date: string | null
  inventors: string | null
  /**
   * NIH project_numbers this patent is linked to via project_patents.
   * One patent can link to multiple projects. Used by Key Organizations
   * rollup to attribute patents to the funded org (assignee strings are
   * USPTO-formatted and don't match NIH org_name).
   */
  project_numbers: string[]
}

export interface PublicationItem {
  pmid: string
  publication_title: string | null
  journal: string | null
  publication_date: string | null
  /**
   * Year from publications.pub_year. Frequently populated when
   * publication_date is NULL — PubMed esummary's pubdate format
   * ("2024 Spring" / "Mar-Apr" / etc.) sometimes fails our date
   * parser but yields a clean year. Renderer should prefer this
   * over deriving from publication_date.
   */
  pub_year: number | null
  authors: string | null
  abstract: string | null
}

export interface OrgStats {
  org_name: string
  projects: number
  funding: number
  trials: number
  patents: number
}

export interface ResearcherStats {
  pi_name: string
  projects: number
  funding: number
  org: string | null
}

export interface MarketContext {
  overview: string
  marketSize: string | null
  keyPlayers: string[]
  recentDevelopments: string[]
  competitiveLandscape: string
  sources: string[]
}

// Agent outputs
export interface ProjectsAgentOutput {
  items: ProjectItem[]
  totalFunding: number
  byYear: Array<{ year: number; projects: number; funding: number; isPartial?: boolean }>
  byCategory: Array<{ category: string; projects: number; funding: number }>
  byOrg: Array<{ org: string; projects: number; funding: number }>
  // All project_number variants (before deduplication) for linked data lookup
  // This ensures we find trials/patents linked to any variant of a deduplicated project
  allProjectNumbers: string[]
}

export interface TrialsAgentOutput {
  items: TrialItem[]
  byPhase: Record<string, number>
  byStatus: Record<string, number>
  /**
   * Diagnostic counters from each lookup path. Persisted via agent_outputs
   * so production runs leave durable evidence of how trials were sourced,
   * independently of ephemeral function logs.
   */
  diagnostics?: {
    topicQueryProvided: boolean
    topicQueryLength: number
    path1Count: number
    path2CandidateCount: number
    path2FetchedRowCount: number
    path2Status:
      | 'ok'
      | 'skipped_no_query'
      | 'embedding_error'
      | 'rpc_error'
      | 'no_candidates'
      | 'fetch_error'
    path2ErrorMessage?: string
  }
}

export interface PatentsAgentOutput {
  items: PatentItem[]
  byAssignee: Array<{ assignee: string; count: number }>
  recentCount: number
}

export interface PublicationsAgentOutput {
  items: PublicationItem[]
  byJournal: Array<{ journal: string; count: number }>
  byYear: Array<{ year: number; count: number }>
  /**
   * Total unique journals across all items, BEFORE byJournal's top-10 slice.
   * Renderer should use this in the "Unique journals: N" summary line —
   * otherwise byJournal.length surfaces (capped at 10) and makes the
   * publication base look unrealistically narrow on large samples.
   */
  totalUniqueJournals: number
}

export interface MarketAgentOutput {
  context: MarketContext
}

export interface AllAgentOutputs {
  projects: ProjectsAgentOutput
  trials: TrialsAgentOutput
  patents: PatentsAgentOutput
  publications: PublicationsAgentOutput
  market: MarketAgentOutput
}

// Structured investor risk factors
export interface InvestorRiskFactors {
  scientific: string | null     // Scientific/technical risks
  regulatory: string | null     // Regulatory pathway risks
  competitive: string | null    // Competitive/market timing risks
  execution: string | null      // Execution/team/capability risks
  overall: string               // Summary of most critical risk
}

// Signals analysis for persona-aware interpretation
export interface SignalsAnalysis {
  // Researcher-focused signals
  positioningMap: string        // Who's doing what approach
  collaborationSignals: string  // Co-PI patterns, institutional links
  methodologicalTrends: string  // Emerging techniques, declining approaches
  // gapAnalysis was removed once the dedicated White Space Analysis section
  // shipped — that section replaces this field with a quantified,
  // data-grounded multi-dimensional gap audit. Legacy reports may still
  // have a value in this field on the JSONB blob; readers should ignore it.

  // Investor-focused signals
  trlAssessment: string         // Technology readiness breakdown
  commercialReadiness: string   // How close to market
  ipConcentration: string       // Who owns the IP landscape
  riskFactors: string | InvestorRiskFactors  // Key risks (string for legacy, structured for new)
  comparables: string           // Similar technologies/companies
}

// Curated publication with explanation
export interface CuratedPublication {
  pmid: string
  title: string
  journal: string | null
  year: number | null
  significance: string          // Why this paper matters
  keyFinding: string            // One sentence takeaway
}

// Field Maturity Assessment - synthesizes preprint ratio, trial phases, patent activity
export interface FieldMaturityAssessment {
  trlEstimate: string           // e.g., "TRL 3-4" or "Early Research (TRL 1-3)"
  maturityNarrative: string     // 2-3 sentence explanation (embeds confidence+evidence tags inline)
  /** Concrete historical reference point for this TRL — e.g. "roughly where CRISPR was in 2015-2017". */
  benchmarkComparison?: string
  evidenceSummary: {
    preprintRatio: string       // e.g., "35% preprints signals emerging field"
    trialProgression: string    // e.g., "No late-stage trials observed"
    patentActivity: string      // e.g., "0 patents in last 2 years"
  }
  /** Persona-appropriate "so what" advice tied to this maturity assessment. */
  strategicImplications?: string
  overallAssessment: 'nascent' | 'emerging' | 'maturing' | 'established'
}

// Competitive Topology - methodological clusters
export interface CompetitiveTopologyCluster {
  approach: string              // e.g., "MEA-based recording"
  keyPlayers: string[]          // Academic + commercial
  maturityLevel: string         // e.g., "Mature", "Emerging", "Nascent"
  commercialReadiness: string   // Brief assessment
}

export interface CompetitiveTopology {
  clusters: CompetitiveTopologyCluster[]
  narrative: string             // Brief synthesis
  /** Persona-appropriate "so what" advice tied to the cluster landscape. */
  strategicImplications?: string
}

// White Space Analysis — quantified coverage-gap audit across topic-specific
// dimensions. Grounded in the actual analyzed project sample (deterministic
// keyword counting) with an LLM-authored narrative layer that MUST agree
// with the counts. Cross-referenced against the broader NIH RePORTER
// projects table so a "gap in the topic slice" can be distinguished from
// "not relevant to NIH funding at all."
export interface CoverageCategory {
  name: string                    // e.g., "Lung", "Pancreatic", "cfDNA methylation"
  keywords: string[]              // keywords used to identify matching projects
  projectCount: number            // matched projects in the analyzed sample
  fundingTotal: number            // sum of total_cost across matched projects
  broaderNihCount: number         // matched projects across ALL NIH RePORTER (not just topic slice)
  projectExamples: string[]       // up to 3 project_numbers for provenance
}

export interface CoverageDimension {
  name: string                    // e.g., "Cancer Type"
  description: string             // one-sentence explanation of this dimension for the topic
  categories: CoverageCategory[]
  totalMatched: number            // projects matching at least one category
  totalUnclassified: number       // projects matching none
  narrative: string               // LLM-authored 2-3 sentences on what stands out
}

export interface WhiteSpaceOpportunity {
  dimensionName: string
  categoryName: string
  sampleCount: number             // count in analyzed sample
  sampleShare: number             // % of sample projects (0-1)
  broaderNihCount: number         // count in broader NIH data
  gapSignal: 'sparse-in-topic' | 'absent-in-topic' | 'sample-under-broader' // categorization
  rationale: string               // LLM narrative — why this white space might matter
}

export interface WhiteSpaceAnalysis {
  overview: string                // 3-4 sentences framing the coverage picture
  scopeNote: string               // Standing caveat about NIH RePORTER scope
  dimensions: CoverageDimension[]
  topOpportunities: WhiteSpaceOpportunity[]
  totalProjects: number           // for chart/table denominators
  totalFunding: number
  /** Persona-appropriate "so what" — grant strategy for researchers,
   *  investment thesis framing for investors. Tied to the top opportunities. */
  strategicImplications?: string
}

// IP Landscape Assessment
export interface IPLandscapeAssessment {
  concentration: 'fragmented' | 'moderately_concentrated' | 'highly_concentrated'
  dominantAssignees: string[]
  freedomToOperate: string      // Assessment of FTO concerns
  recentActivityTrend: string   // e.g., "Declining - 0 patents in 2 years"
  narrative: string             // 2-3 sentences
  /** Persona-appropriate "so what" advice tied to the IP finding. */
  strategicImplications?: string
}

/**
 * Surprising Findings — flags what's UNEXPECTED in the data, not just
 * what's present. Detected algorithmically first (translation-gap orgs,
 * publication-vs-trial imbalances, broader-NIH gaps, etc.) then narrated
 * by an LLM. See src/lib/reports/surprising.ts for detector definitions.
 */
export interface SurprisingFindingItem {
  headline: string
  interpretation: string
  evidence: string
  category: string
}

export interface ReportData {
  executiveSummary: string
  marketContext: MarketContext
  fundingStats: FundingStats
  projects: ProjectItem[]
  clinicalTrials: TrialItem[]
  patents: PatentItem[]
  publications: PublicationItem[]
  topOrganizations: OrgStats[]
  topResearchers: ResearcherStats[]
  markdownContent: string
  // New persona-aware fields
  persona?: ReportPersona
  signalsAnalysis?: SignalsAnalysis
  curatedPublications?: CuratedPublication[]
  // New assessment fields
  fieldMaturity?: FieldMaturityAssessment
  competitiveTopology?: CompetitiveTopology
  ipLandscape?: IPLandscapeAssessment
  whiteSpace?: WhiteSpaceAnalysis
  surprisingFindings?: SurprisingFindingItem[]
  /** Persona-specific actionable next-steps checklist, generated at the end of synthesis. */
  nextSteps?: string
}

export interface GenerateReportOptions {
  type: ReportType
  topic?: string
  userId: string
  dataLimited?: boolean
  persona?: ReportPersona  // Defaults to 'researcher'
}
