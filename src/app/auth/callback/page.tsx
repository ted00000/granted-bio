'use client'

import { useEffect, useState, Suspense, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

function AuthCallbackHandler() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const hasRun = useRef(false)

  const next = searchParams.get('next') || '/chat'
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  useEffect(() => {
    // Prevent running multiple times (OAuth codes are single-use)
    if (hasRun.current) return
    hasRun.current = true

    const supabase = createBrowserSupabaseClient()

    const handleAuthCallback = async () => {
      try {
        // First, check if there's already a session (from previous successful auth)
        const { data: { session: existingSession } } = await supabase.auth.getSession()

        let session = existingSession

        // If no session and we have a code, exchange it
        if (!session && code) {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            console.error('Code exchange error:', exchangeError)
            setError(exchangeError.message)
            return
          }
          session = data.session
        }

        // For magic links, tokens in hash are handled by Supabase client automatically
        // If still no session, wait and retry (magic link tokens take a moment)
        if (!session) {
          await new Promise(resolve => setTimeout(resolve, 500))
          const { data: { session: retrySession } } = await supabase.auth.getSession()
          session = retrySession
        }

        if (session) {
          // Handle password recovery
          if (type === 'recovery') {
            window.location.href = '/update-password'
            return
          }

          // Check if user is admin
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', session.user.id)
            .single()

          if (profile?.role === 'admin') {
            window.location.href = '/admin'
            return
          }

          // Regular user - go to chat (hard redirect to ensure cookies are read)
          window.location.href = next
        } else {
          setError('Unable to sign in. Please try again.')
        }
      } catch (err) {
        console.error('Auth callback exception:', err)
        setError('An error occurred during sign in.')
      }
    }

    handleAuthCallback()
  }, [code, type, next])

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-sm mx-auto px-6">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-lg font-medium text-gray-900 mb-2">Sign in failed</h2>
          <p className="text-sm text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="text-sm text-[#E07A5F] hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500">Signing you in...</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    }>
      <AuthCallbackHandler />
    </Suspense>
  )
}
