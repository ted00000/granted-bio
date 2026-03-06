// Types for Intelligence Reports feature

export type ReportType = 'topic' | 'portfolio'
export type ReportStatus = 'generating' | 'complete' | 'failed'

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
}

export interface GenerateReportOptions {
  type: ReportType
  topic?: string
  userId: string
  dataLimited?: boolean
}
