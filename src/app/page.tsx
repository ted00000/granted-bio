'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/chat'
  const message = searchParams.get('message')

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const supabase = createBrowserSupabaseClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        setLoading(false)
        return
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters')
        setLoading(false)
        return
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        setSuccess(true)
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        router.push(redirect)
        router.refresh()
      }
    }
  }

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Check your email</h3>
        <p className="text-sm text-gray-500">
          We sent a confirmation link to<br />
          <span className="text-gray-900">{email}</span>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {message === 'password_updated' && (
        <p className="text-sm text-green-600 text-center">
          Password updated. Please sign in.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}

      <div>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
      </div>

      <div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
      </div>

      {mode === 'signup' && (
        <div>
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
      >
        {loading ? (mode === 'login' ? 'Signing in...' : 'Creating account...') : (mode === 'login' ? 'Sign in' : 'Create account')}
      </button>

      <div className="text-center text-sm text-gray-500">
        {mode === 'login' ? (
          <>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className="text-[#E07A5F] hover:underline"
            >
              Create an account
            </button>
            <span className="mx-2">·</span>
            <Link href="/reset-password" className="text-gray-500 hover:text-gray-900 hover:underline">
              Forgot password
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode('login')}
            className="text-[#E07A5F] hover:underline"
          >
            Already have an account? Sign in
          </button>
        )}
      </div>
    </form>
  )
}

function AuthFormFallback() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-100 rounded-lg" />
      <div className="h-12 bg-gray-200 rounded-lg" />
    </div>
  )
}

const stats = [
  { label: 'NIH Projects', value: '129K' },
  { label: 'Patents', value: '46K' },
  { label: 'Publications', value: '203K' },
  { label: 'Clinical Trials', value: '38K' },
]


export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </span>
          <Link
            href="/chat"
            className="text-sm text-gray-500 hover:text-[#E07A5F] transition-colors"
          >
            Go to app
          </Link>
        </nav>
      </header>

      {/* Main */}
      <main className="px-6 py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 md:gap-24 items-start">
            {/* Left column */}
            <div className="space-y-8">
              <div className="space-y-4">
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 leading-tight">
                  Life Sciences Grant Intelligence
                </h1>
                <p className="text-lg text-gray-500 leading-relaxed">
                  Search across NIH grants, patents, publications, and clinical trials with natural language. Find funded research, discover competitors, and build qualified leads.
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-6">
                {stats.map((stat) => (
                  <div key={stat.label}>
                    <div className="text-3xl font-semibold text-gray-900">
                      {stat.value}
                    </div>
                    <div className="text-sm text-gray-500">{stat.label}</div>
                  </div>
                ))}
              </div>

            </div>

            {/* Right column - Auth */}
            <div className="md:max-w-sm md:ml-auto">
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
                <h2 className="text-lg font-medium text-gray-900 mb-6">
                  Get started
                </h2>
                <Suspense fallback={<AuthFormFallback />}>
                  <AuthForm />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-8 mt-auto">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm text-gray-400">
Data sourced from NIH RePORTER
          </p>
        </div>
      </footer>
    </div>
  )
}
