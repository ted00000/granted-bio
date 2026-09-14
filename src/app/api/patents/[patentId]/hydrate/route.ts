// POST /api/patents/[patentId]/hydrate — the endpoint the patent
// detail page fires when it lands on a row with NULL api_last_updated.
//
// Access is intentionally open: patents in our index are public data,
// and only patent_ids that already exist in our patents table can be
// hydrated (the hydrator returns `patent_not_in_index` otherwise). So
// there's no vector to burn our USPTO rate budget with random IDs.
//
// Uses the service-role Supabase client so the write goes through
// regardless of the caller's session (including anonymous sample
// viewers).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hydratePatent } from '@/lib/patents/hydrator'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ patentId: string }> },
) {
  const { patentId } = await params

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { error: 'server_misconfigured' },
      { status: 500 },
    )
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const result = await hydratePatent(patentId, admin)

  switch (result.status) {
    case 'hydrated':
    case 'already_hydrated':
      return NextResponse.json({ status: result.status })
    case 'not_found_in_odp':
      return NextResponse.json(
        { status: 'not_found_in_odp' },
        { status: 404 },
      )
    case 'rate_limited': {
      const headers = new Headers()
      if (result.retryAfterSeconds != null) {
        headers.set('Retry-After', String(result.retryAfterSeconds))
      }
      return NextResponse.json(
        { status: 'rate_limited', retry_after_seconds: result.retryAfterSeconds },
        { status: 429, headers },
      )
    }
    case 'error':
    default:
      return NextResponse.json(
        { status: 'error', error: result.error },
        { status: 500 },
      )
  }
}
