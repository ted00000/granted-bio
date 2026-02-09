import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/chat'
  const type = searchParams.get('type')

  console.log('[Auth Callback] Starting:', { hasCode: !!code, next, type, origin })

  if (code) {
    // Collect cookies to set on the response
    const cookiesToSet: { name: string; value: string; options: any }[] = []

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

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    console.log('[Auth Callback] Exchange result:', {
      success: !error,
      hasSession: !!data?.session,
      error: error?.message,
      cookiesCount: cookiesToSet.length
    })

    if (!error && data?.session) {
      // Determine redirect URL
      let redirectUrl = `${origin}${next}`

      if (type === 'recovery') {
        redirectUrl = `${origin}/update-password`
      } else {
        // Check if user is admin
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', user.id)
            .single()

          if (profile?.role === 'admin') {
            redirectUrl = `${origin}/admin`
          }
        }
      }

      // Create response and attach all cookies
      console.log('[Auth Callback] Redirecting to:', redirectUrl)
      const response = NextResponse.redirect(redirectUrl)
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
      return response
    }
  }

  // Auth error - redirect to error page or home
  console.log('[Auth Callback] Failed - no code or exchange failed, redirecting to home')
  return NextResponse.redirect(`${origin}/?error=auth_callback_error`)
}
