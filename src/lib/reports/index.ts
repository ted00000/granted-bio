// Intelligence Reports Module
// Premium feature for generating research landscape reports

export { generateTopicReport, generatePortfolioReport, checkProjectCount } from './generate'
export { synthesizeReport } from './synthesize'

export type {
  ReportType,
  ReportStatus,
  ReportMetadata,
  ReportData,
  GenerateReportOptions,
  FundingStats,
  ProjectItem,
  TrialItem,
  PatentItem,
  PublicationItem,
  OrgStats,
  ResearcherStats,
  MarketContext,
} from './types'
