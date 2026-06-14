// Shared sign-in / sign-up form (Google OAuth + magic link via Supabase).
//
// Used in two places:
//
// 1. Inline on the home page hero (right column). In that case the
//    component reads `redirect` from the URL search params so a link
//    like /?redirect=/reports can still influence where the auth
//    callback lands.
//
// 2. Inside <SignUpModal> on deep-page CTAs (final CTA on /, all CTAs
//    on /reports and /pricing). In that case the caller passes an
//    explicit `redirect` prop so the modal-bound user lands on the
//    page that matched their intent (e.g., /reports) after the auth
//    round-trip.
//
// When both an explicit prop and a URL param are present, the prop
// wins — the caller is asserting the intent.

'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

interface AuthFormProps {
  /** Optional explicit redirect destination after auth completes. */
  redirect?: string
}

export function AuthForm({ redirect: redirectProp }: AuthFormProps = {}) {
  const searchParams = useSearchParams()
  const redirect = redirectProp || searchParams.get('redirect') || '/chat'
  const authError = searchParams.get('error')

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState<'google' | 'magic' | null>(null)
  const [error, setError] = useState<string | null>(
    authError === 'auth_callback_error' ? 'Authentication failed. Please try again.' : null
  )
  const [magicLinkSent, setMagicLinkSent] = useState(false)

  const supabase = createBrowserSupabaseClient()

  const handleGoogleSignIn = async () => {
    setLoading('google')
    setError(null)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${redirect}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(null)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading('magic')
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${redirect}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(null)
    } else {
      setMagicLinkSent(true)
    }
  }

  if (magicLinkSent) {
    return (
      <div className="w-full py-8 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Check your email</h3>
        <p className="text-sm text-gray-500">
          We sent a sign-in link to<br />
          <span className="text-gray-900">{email}</span>
        </p>
        <p className="mt-3 text-xs font-medium text-[#E07A5F]">
          Not in your inbox? Check your spam or promotions folder.
        </p>
        <button
          onClick={() => setMagicLinkSent(false)}
          className="mt-4 text-sm text-gray-500 hover:text-gray-900"
        >
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      {/* Google Sign In */}
      <button
        onClick={handleGoogleSignIn}
        disabled={loading !== null}
        className="w-full py-3 px-4 bg-white border border-gray-200 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-3"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {loading === 'google' ? 'Signing in...' : 'Continue with Google'}
      </button>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-2 bg-white text-gray-400">or</span>
        </div>
      </div>

      {/* Magic Link */}
      <form onSubmit={handleMagicLink} className="space-y-3">
        <input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <button
          type="submit"
          disabled={loading !== null}
          className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
        >
          {loading === 'magic' ? 'Sending...' : 'Sign in with email'}
        </button>
      </form>

      <p className="text-xs text-gray-400 text-center">
        We&apos;ll send you a magic link to sign in
      </p>
    </div>
  )
}

export function AuthFormFallback() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-200 rounded-lg" />
    </div>
  )
}
