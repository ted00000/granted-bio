import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/chat'

  if (code) {
    try {
      const supabase = await createServerSupabaseClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        console.error('Auth callback error:', error)
        return NextResponse.redirect(`${origin}/?error=auth_failed`)
      }

      // Handle password recovery redirect
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/update-password`)
      }

      // Check if user is admin and redirect accordingly
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        try {
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', user.id)
            .single()

          if (profile?.role === 'admin') {
            return NextResponse.redirect(`${origin}/admin`)
          }
        } catch {
          // Profile might not exist yet for new users, that's ok
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    } catch (err) {
      console.error('Auth callback exception:', err)
      return NextResponse.redirect(`${origin}/?error=auth_exception`)
    }
  }

  // No code provided
  return NextResponse.redirect(`${origin}/?error=no_code`)
}
