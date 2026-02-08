'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

function AuthCallbackHandler() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Initializing...')

  const next = searchParams.get('next') || '/chat'
  const code = searchParams.get('code')
  const type = searchParams.get('type')

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        setStatus('Session found, redirecting...')

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

        // Regular user - go to chat
        window.location.href = next
      }
    })

    // Also try to exchange code if present
    const handleCode = async () => {
      if (code) {
        setStatus('Exchanging code...')
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          console.error('Code exchange error:', exchangeError)
          // Don't set error - the auth state change listener will handle existing sessions
        }
      }

      // Check for existing session (will trigger onAuthStateChange if found)
      setStatus('Checking session...')
      const { data: { session } } = await supabase.auth.getSession()

      // If no session after a delay, show error
      if (!session) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const { data: { session: retrySession } } = await supabase.auth.getSession()
        if (!retrySession) {
          setError('Unable to sign in. Please try again.')
        }
      }
    }

    handleCode()

    return () => {
      subscription.unsubscribe()
    }
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
        <p className="text-gray-500">{status}</p>
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
