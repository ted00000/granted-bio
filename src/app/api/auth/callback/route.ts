import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/chat'
  const type = searchParams.get('type')

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

    if (!error && data?.session) {
      // Determine redirect URL
      let redirectUrl = `${origin}${next}`

      if (type === 'recovery') {
        redirectUrl = `${origin}/update-password`
      } else {
        // Check if user is admin
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // Fetch profile - if it doesn't exist (race condition with trigger), create it
          let { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', user.id)
            .single()

          // If profile doesn't exist, create it as fallback
          // This handles the race condition where trigger hasn't run yet
          if (!profile) {
            const { data: newProfile } = await supabase
              .from('user_profiles')
              .upsert({
                id: user.id,
                email: user.email,
                full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
                avatar_url: user.user_metadata?.avatar_url || null,
                role: 'user',
                tier: 'free'
              }, { onConflict: 'id' })
              .select('role')
              .single()
            profile = newProfile
          }

          if (profile?.role === 'admin') {
            redirectUrl = `${origin}/admin`
          }
        }
      }

      const response = NextResponse.redirect(redirectUrl)
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
      return response
    }
  }

  // Auth error - redirect to home with error
  return NextResponse.redirect(`${origin}/?error=auth_callback_error`)
}
