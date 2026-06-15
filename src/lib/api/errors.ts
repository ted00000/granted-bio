// Safe error responses for API routes.
//
// PostgREST errors (and many other downstream errors) include details
// like column names, SQL hints, and internal IDs that we don't want
// to expose to the client. Most of our routes were doing
// `return NextResponse.json({ error: error.message }, ...)` which
// surfaced these directly. Replace with `apiError(...)` to log the
// real cause server-side (full context) while sending a generic
// message to the client.
//
// Usage:
//   import { apiError } from '@/lib/api/errors'
//   ...
//   catch (err) {
//     return apiError('Failed to save trial', err, 500)
//   }

import { NextResponse } from 'next/server'

interface ApiErrorOptions {
  /** Optional structured context to attach to the server log. */
  context?: Record<string, unknown>
  /** Override the message sent to the client. Defaults to publicMessage. */
  clientMessage?: string
}

/**
 * Log the underlying error server-side with whatever detail is
 * available, and respond to the client with a generic message and the
 * given HTTP status. Never leaks DB hints, SQL fragments, internal
 * IDs, or stack traces.
 */
export function apiError(
  publicMessage: string,
  cause: unknown,
  status = 500,
  options: ApiErrorOptions = {}
): NextResponse {
  const errMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'unknown error'

  // Server log: full detail. Client response: generic.
  console.error(
    `[API ${status}] ${publicMessage}: ${errMessage}`,
    options.context ?? {}
  )

  return NextResponse.json(
    { error: options.clientMessage ?? publicMessage },
    { status }
  )
}
