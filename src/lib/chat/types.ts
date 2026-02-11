// Chat types and interfaces for the AI agent system

export type PersonaType = 'researcher' | 'bd' | 'investor' | 'trials'

// Intent-based selection (maps to personas for prompts)
export type IntentType = 'research' | 'market' | 'leads' | 'trials'

export const INTENT_TO_PERSONA: Record<IntentType, PersonaType> = {
  research: 'researcher',
  market: 'investor',
  leads: 'bd',
  trials: 'trials',
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  result: unknown
}

// Search filters matching the existing API
export interface SearchFilters {
  fiscal_year?: number[]
  primary_category?: string[]
  org_type?: string[]
  is_sbir?: boolean
  is_sttr?: boolean
  min_funding?: number
  max_funding?: number
  state?: string
  activity_code?: string[]
  supplements?: 'all' | 'base' | 'supplements'
}

// Tool parameter types
export interface SearchProjectsParams {
  query: string
  filters?: SearchFilters
  limit?: number
}

export interface GetCompanyProfileParams {
  org_name: string
}

export interface GetPIProfileParams {
  pi_name: string
}

export interface FindSimilarParams {
  project_id: string
  limit?: number
}

export interface SearchPatentsParams {
  query: string
  limit?: number
}

export interface KeywordSearchParams {
  keyword: string
  filters?: {
    primary_category?: string[]
    org_type?: string[]
    state?: string[]
    min_funding?: number
  }
}

export interface KeywordSearchResult {
  summary: string // Natural language summary for Claude to read
  total_count: number
  by_category: Record<string, number>
  by_org_type: Record<string, number>
  sample_results: Array<{
    application_id: string
    title: string
    org_name: string | null
    org_state: string | null
    org_type: string | null
    primary_category: string | null
    total_cost: number | null
    pi_names: string | null
    pi_email: string | null
  }>
}

// Search result types (matching existing API)
export interface ProjectResult {
  id: string
  application_id: string
  project_number: string
  title: string
  phr: string | null
  org_name: string | null
  org_type: string | null
  org_city: string | null
  org_state: string | null
  total_cost: number | null
  fiscal_year: number | null
  funding_mechanism: string | null
  primary_category: string | null
  biotools_confidence: number | null
  biotools_reasoning: string | null
  pi_names: string | null
  is_supplement: boolean | null
  supplement_number: string | null
  similarity?: number
}

export interface CompanyProfile {
  org_name: string
  total_funding: number
  project_count: number
  patent_count: number
  publication_count: number
  clinical_trial_count: number
  projects: ProjectResult[]
  primary_categories: Record<string, number>
  fiscal_years: number[]
  states: string[]
}

export interface PIProfile {
  pi_name: string
  organizations: string[]
  total_funding: number
  project_count: number
  publication_count: number
  projects: ProjectResult[]
}

export interface PatentResult {
  patent_id: string
  patent_title: string
  project_number: string | null
  similarity?: number
}

export interface GetPatentDetailsParams {
  patent_id: string
}

export interface PatentDetails {
  patent_id: string
  patent_title: string
  patent_abstract: string | null
  patent_date: string | null
  patent_type: string | null
  assignees: string[]
  inventors: string[]
  cpc_codes: string[]
  cited_by_count: number
  claims_count: number
  // Link back to NIH project if available
  linked_project_number: string | null
}

// User tier for access control
export type UserTier = 'free' | 'basic' | 'advanced' | 'unlimited'

export interface UserAccess {
  tier: UserTier
  resultsLimit: number
  canExport: boolean
  canSeeEmails: boolean
  canSeeAbstracts: boolean
  searchesPerMonth: number | null // null = unlimited
}

// Tier configuration
export const TIER_LIMITS: Record<UserTier, UserAccess> = {
  free: {
    tier: 'free',
    resultsLimit: 10,
    canExport: false,
    canSeeEmails: false,
    canSeeAbstracts: false,
    searchesPerMonth: 25,
  },
  basic: {
    tier: 'basic',
    resultsLimit: 50,
    canExport: false,
    canSeeEmails: false,
    canSeeAbstracts: true,
    searchesPerMonth: 100,
  },
  advanced: {
    tier: 'advanced',
    resultsLimit: 200,
    canExport: true,
    canSeeEmails: true,
    canSeeAbstracts: true,
    searchesPerMonth: 500,
  },
  unlimited: {
    tier: 'unlimited',
    resultsLimit: 1000,
    canExport: true,
    canSeeEmails: true,
    canSeeAbstracts: true,
    searchesPerMonth: null,
  },
}

// Chat request/response types
export interface ChatRequest {
  messages: Message[]
  persona: PersonaType
}

export interface ChatResponse {
  message: Message
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}
