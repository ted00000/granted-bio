import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/chat'
  const type = searchParams.get('type')

  console.log('[Auth Callback] Starting:', { hasCode: !!code, next, type, origin })

  if (code) {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    console.log('[Auth Callback] Exchange result:', {
      success: !error,
      hasSession: !!data?.session,
      error: error?.message
    })

    if (!error && data?.session) {
      // Handle password recovery redirect
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/update-password`)
      }

      // Check if user is admin
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        if (profile?.role === 'admin') {
          return NextResponse.redirect(`${origin}/admin`)
        }
      }

      // Successful auth - redirect to next page
      console.log('[Auth Callback] Redirecting to:', `${origin}${next}`)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Auth error - redirect to error page or home
  console.log('[Auth Callback] Failed - no code or exchange failed, redirecting to home')
  return NextResponse.redirect(`${origin}/?error=auth_callback_error`)
}
