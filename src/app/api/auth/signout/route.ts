import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Use the same explicit-cookie-tracking pattern as /api/auth/callback so
  // the cleared session cookies are guaranteed to land on the response.
  // (The implicit cookies() handler can fail to propagate cleared cookies
  // through NextResponse.redirect, which is what was making sign out
  // appear to "work" client-side while the server still had a valid session.)
  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookies) {
          cookies.forEach((cookie) => {
            cookiesToSet.push(cookie)
          })
        },
      },
    }
  )

  await supabase.auth.signOut()

  // Return JSON so the client-side caller (AuthContext.signOut) can also
  // handle navigation itself rather than rely on a server-driven redirect.
  const response = NextResponse.json({ success: true })
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options)
  })
  return response
}
