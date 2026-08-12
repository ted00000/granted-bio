// Maintenance-mode bypass endpoint. Visit /api/maintenance/bypass?token=X
// once during MAINTENANCE_MODE=true; if the token matches the
// MAINTENANCE_BYPASS_TOKEN env var, we set a bypass cookie the
// middleware honors on subsequent requests. Redirects to /.
//
// Set MAINTENANCE_BYPASS_TOKEN to a shared secret only trusted parties
// know (admins, testers, the reviewer we sent a preview link to).
//
// The cookie is HttpOnly + SameSite=Lax + 30-day max-age. Clearing it
// requires deleting the cookie manually in the browser OR revisiting
// the endpoint with token=clear.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'granted_maintenance_bypass'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  const expected = process.env.MAINTENANCE_BYPASS_TOKEN ?? ''

  const home = request.nextUrl.clone()
  home.pathname = '/'
  home.search = ''

  // Explicit clear path — useful for testing the maintenance experience
  // yourself after you've set the bypass cookie.
  if (token === 'clear') {
    const response = NextResponse.redirect(home)
    response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
    return response
  }

  // If maintenance mode isn't on OR the token doesn't match, no-op
  // and send the visitor to the homepage. We do NOT reveal whether
  // the token was wrong vs the env var was unset — same 302 either
  // way — so the endpoint doesn't leak whether a token guess was
  // close.
  if (!expected || token !== expected) {
    return NextResponse.redirect(home)
  }

  const response = NextResponse.redirect(home)
  response.cookies.set(COOKIE_NAME, '1', {
    maxAge: MAX_AGE_SECONDS,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
