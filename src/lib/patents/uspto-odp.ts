// USPTO Open Data Portal (ODP) client — three functions covering
// the lazy-on-view patent enrichment flow:
//
//   1. searchApplicationNumber   — patent number → application number
//   2. fetchApplicationMetaData  — bibliographic metadata
//   3. fetchAssignmentHistory    — ownership transfer history
//
// Auth is a single `X-API-KEY` header, key from env. Base URL is
// api.uspto.gov (data.uspto.gov is the docs SPA and 400s on API paths).
// Rate limit is 60 general requests / min / key — we do NOT proactively
// gate here; we respect 429 with Retry-After and let the caller decide
// how to surface that to the user.
//
// Verified working 2026-09-14 against Georgia Tech patent 12070567.

const ODP_BASE_URL = 'https://api.uspto.gov'

export class UsptoOdpError extends Error {
  readonly status: number
  readonly retryAfterSeconds: number | null
  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'UsptoOdpError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function apiKey(): string {
  const k = process.env.USPTO_ODP_API_KEY
  if (!k) {
    throw new UsptoOdpError(
      'USPTO_ODP_API_KEY is not configured in the environment. Add it to .env.local and Vercel env.',
      500,
    )
  }
  return k
}

// Small wrapper that inserts the auth header and normalizes errors.
// Returns parsed JSON on 2xx. Throws UsptoOdpError on 4xx/5xx. 404 is
// returned as `null` — a legitimate "we don't know this patent" from
// USPTO, distinct from an error.
async function odpFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const url = `${ODP_BASE_URL}${path}`
  const headers = new Headers(init.headers || {})
  headers.set('X-API-KEY', apiKey())
  headers.set('Accept', 'application/json')
  if (init.body) headers.set('Content-Type', 'application/json')

  const res = await fetch(url, { ...init, headers })

  if (res.status === 404) return null

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    const seconds = retryAfter ? parseInt(retryAfter, 10) : 60
    throw new UsptoOdpError(
      `USPTO ODP rate limit hit. Retry after ${seconds}s.`,
      429,
      Number.isFinite(seconds) ? seconds : 60,
    )
  }

  if (!res.ok) {
    // Best-effort body inclusion for debugging; USPTO returns JSON with
    // a `message` field on most errors.
    let detail = ''
    try {
      const j = await res.json()
      detail = j.message ?? j.detailedMessage ?? ''
    } catch {
      /* ignore parse errors on non-JSON bodies */
    }
    throw new UsptoOdpError(
      `USPTO ODP ${res.status}: ${detail || res.statusText}`,
      res.status,
    )
  }

  return (await res.json()) as T
}

// ---------------------------------------------------------------
// Response type shapes — only the fields we actually consume. USPTO
// returns much more; extra fields are ignored.
// ---------------------------------------------------------------

interface SearchResponse {
  count: number
  patentFileWrapperDataBag: Array<{
    applicationNumberText?: string
  }>
}

interface InventorEntry {
  inventorNameText?: string
  firstName?: string
  lastName?: string
  countryCode?: string
}

interface ApplicantEntry {
  applicantNameText?: string
}

interface ApplicationMetaData {
  applicationTypeCode?: string
  applicationTypeLabelName?: string
  applicationStatusDescriptionText?: string
  filingDate?: string
  grantDate?: string
  patentNumber?: string
  inventionTitle?: string
  examinerNameText?: string
  groupArtUnitNumber?: string
  uspcSymbolText?: string
  cpcClassificationBag?: string[]
  inventorBag?: InventorEntry[]
  applicantBag?: ApplicantEntry[]
}

interface MetaDataResponse {
  count: number
  patentFileWrapperDataBag: Array<{
    applicationMetaData?: ApplicationMetaData
  }>
}

interface AssigneeEntry {
  assigneeNameText?: string
}

interface AssignmentEntry {
  conveyanceText?: string
  assignmentRecordedDate?: string
  assignmentReceivedDate?: string
  assigneeBag?: AssigneeEntry[]
}

interface AssignmentResponse {
  count: number
  patentFileWrapperDataBag: Array<{
    assignmentBag?: AssignmentEntry[]
  }>
}

// ---------------------------------------------------------------
// Public API — each function returns { value, raw } so the caller can
// both consume the extracted data AND persist the full response for
// future column additions (see patents.api_raw_data in the
// 20260914_store_api_raw_data.sql migration).
// ---------------------------------------------------------------

export interface Fetched<T> {
  value: T
  raw: unknown | null
}

/**
 * Look up the USPTO application number for a granted patent number.
 * Uses the search endpoint (POST body) with a Solr-style filter and a
 * fields allowlist to keep the response minimal.
 * Returns value=null if USPTO cannot find the patent.
 */
export async function searchApplicationNumber(
  patentNumber: string,
): Promise<Fetched<string | null>> {
  const body = {
    q: `applicationMetaData.patentNumber:${patentNumber}`,
    fields: ['applicationNumberText'],
    pagination: { offset: 0, limit: 1 },
  }
  const res = await odpFetch<SearchResponse>(
    '/api/v1/patent/applications/search',
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res || res.count === 0) return { value: null, raw: res }
  const value = res.patentFileWrapperDataBag[0]?.applicationNumberText ?? null
  return { value, raw: res }
}

/**
 * Fetch bibliographic meta-data for an application number.
 * Returns value=null on 404 or if the response has no rows.
 */
export async function fetchApplicationMetaData(
  applicationNumber: string,
): Promise<Fetched<ApplicationMetaData | null>> {
  const res = await odpFetch<MetaDataResponse>(
    `/api/v1/patent/applications/${encodeURIComponent(applicationNumber)}/meta-data`,
  )
  if (!res || res.count === 0) return { value: null, raw: res }
  const value = res.patentFileWrapperDataBag[0]?.applicationMetaData ?? null
  return { value, raw: res }
}

/**
 * Fetch the assignment history for an application number.
 * Returns value=[] on empty history, value=null on 404.
 */
export async function fetchAssignmentHistory(
  applicationNumber: string,
): Promise<Fetched<AssignmentEntry[] | null>> {
  const res = await odpFetch<AssignmentResponse>(
    `/api/v1/patent/applications/${encodeURIComponent(applicationNumber)}/assignment`,
  )
  if (!res || res.count === 0) return { value: null, raw: res }
  const value = res.patentFileWrapperDataBag[0]?.assignmentBag ?? []
  return { value, raw: res }
}

export type { ApplicationMetaData, AssignmentEntry }
