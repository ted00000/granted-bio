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
  byYear: Array<{ year: number; projects: number; funding: number }>
  byCategory: Array<{ category: string; projects: number; funding: number }>
  byOrg: Array<{ org: string; projects: number; funding: number }>
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
  study_status: string | null
  lead_sponsor: string | null
  conditions: string[] | null
  enrollment_count: number | null
}

export interface PatentItem {
  patent_id: string
  patent_title: string | null
  patent_abstract: string | null
  assignee: string | null
  patent_date: string | null
  inventors: string | null
}

export interface PublicationItem {
  pmid: string
  publication_title: string | null
  journal: string | null
  publication_date: string | null
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
  byYear: Array<{ year: number; projects: number; funding: number }>
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
  gapAnalysis: string           // What's NOT being funded/studied

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
  maturityNarrative: string     // 2-3 sentence explanation
  evidenceSummary: {
    preprintRatio: string       // e.g., "35% preprints signals emerging field"
    trialProgression: string    // e.g., "No late-stage trials observed"
    patentActivity: string      // e.g., "0 patents in last 2 years"
  }
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
}

// IP Landscape Assessment
export interface IPLandscapeAssessment {
  concentration: 'fragmented' | 'moderately_concentrated' | 'highly_concentrated'
  dominantAssignees: string[]
  freedomToOperate: string      // Assessment of FTO concerns
  recentActivityTrend: string   // e.g., "Declining - 0 patents in 2 years"
  narrative: string             // 2-3 sentences
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
}

export interface GenerateReportOptions {
  type: ReportType
  topic?: string
  userId: string
  dataLimited?: boolean
  persona?: ReportPersona  // Defaults to 'researcher'
}
