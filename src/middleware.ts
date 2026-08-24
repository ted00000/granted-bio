import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  findValidShareByToken,
  SHARE_TOKEN_HEADER,
  SHARE_REPORT_ID_HEADER,
} from '@/lib/reports/share-tokens'

// Maintenance mode. Toggled by the MAINTENANCE_MODE env var on
// Vercel (or locally): when === 'true', every user-facing page
// redirects to /maintenance. API routes are left alone so
// background systems (Inngest, Stripe webhooks) don't break and
// so the bypass endpoint keeps working. Admins/testers who want to
// preview during maintenance visit /api/maintenance/bypass?token=X
// once — that sets a cookie the middleware honors on subsequent
// requests. See docs/MAINTENANCE_MODE.md for how to flip on/off.
const MAINTENANCE_BYPASS_COOKIE = 'granted_maintenance_bypass'

// /share/[token] and /share/[token]/anything. Matches even trailing
// slash and RSC-payload requests. The rewrite target is the
// /reports/[reportId] tree, so we validate here to keep the rest of
// the middleware and the report layout unaware of share semantics.
const SHARE_URL_PATTERN = /^\/share\/([A-Za-z0-9_-]+)(\/.*)?$/

function shouldServeMaintenance(request: NextRequest): boolean {
  if (process.env.MAINTENANCE_MODE !== 'true') return false
  const pathname = request.nextUrl.pathname
  // Never intercept:
  //  - /maintenance itself (else redirect loop)
  //  - /api/* (background systems + the bypass endpoint)
  //  - Static assets (already excluded by matcher, but belt+suspenders)
  if (pathname === '/maintenance') return false
  if (pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/_next/')) return false
  // Bypass cookie holders pass through.
  if (request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value === '1') return false
  return true
}

export async function middleware(request: NextRequest) {
  if (shouldServeMaintenance(request)) {
    const url = request.nextUrl.clone()
    url.pathname = '/maintenance'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Share link resolution. If this is a /share/[token] request,
  // validate the token and rewrite the URL to /reports/[reportId]/…
  // while stamping headers that fetch-report + layout read to decide
  // whether to skip auth and render in read-only mode. URL bar keeps
  // showing /share/[token]; server serves the report route tree.
  const shareResolution = await resolveShareUrl(request)
  if (shareResolution) return shareResolution

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Helper to create redirect with cookies preserved
  const redirectWithCookies = (pathname: string, searchParams?: Record<string, string>) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        url.searchParams.set(key, value)
      })
    }
    const response = NextResponse.redirect(url)
    // Forward any cookies that were set during session refresh
    supabaseResponse.cookies.getAll().forEach(cookie => {
      response.cookies.set(cookie.name, cookie.value)
    })
    return response
  }

  // Redirect authenticated users from homepage to chat
  if (request.nextUrl.pathname === '/' && user) {
    return redirectWithCookies('/chat')
  }

  // Protect chat route - redirect unauthenticated users to login
  if (request.nextUrl.pathname === '/chat' && !user) {
    return redirectWithCookies('/')
  }

  // Protect admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!user) {
      return redirectWithCookies('/', { redirect: request.nextUrl.pathname })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return redirectWithCookies('/unauthorized')
    }
  }

  return supabaseResponse
}

/**
 * Handle /share/[token] URLs. Returns a NextResponse when the URL is
 * a share URL (either a rewrite to the report tree or a redirect to
 * /share/expired for invalid/revoked/expired tokens); returns null
 * for every other URL so the normal middleware path runs.
 */
async function resolveShareUrl(request: NextRequest): Promise<NextResponse | null> {
  const match = SHARE_URL_PATTERN.exec(request.nextUrl.pathname)
  if (!match) return null

  const token = match[1]
  const trailing = match[2] ?? ''

  // /share/expired is a real leaf page (rendered when a token is
  // invalid). Don't try to validate "expired" as a token.
  if (token === 'expired') return null

  const share = await findValidShareByToken(token)
  if (!share) {
    // Invalid / revoked / expired all map to the same terminal page.
    // We don't distinguish for the recipient — they see "This link
    // no longer works, ask the sender to send a new one."
    const url = request.nextUrl.clone()
    url.pathname = '/share/expired'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Rewrite (server-side URL change, browser URL bar stays put) to
  // the report tree. Stamp headers so downstream fetch-report knows
  // to skip auth and use the admin client with a validated token.
  const rewriteUrl = request.nextUrl.clone()
  rewriteUrl.pathname = `/reports/${share.report_id}${trailing}`

  const headers = new Headers(request.headers)
  headers.set(SHARE_TOKEN_HEADER, token)
  headers.set(SHARE_REPORT_ID_HEADER, share.report_id)

  return NextResponse.rewrite(rewriteUrl, {
    request: { headers },
  })
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/auth (auth callbacks - these handle their own logic)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
