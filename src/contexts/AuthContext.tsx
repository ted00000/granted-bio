'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

interface UserProfile {
  role: 'user' | 'admin' | 'associate'
  tier: 'free' | 'pro' | 'beta'
  firstName: string | null
  betaExpiresAt: string | null
  reportsGenerated: number
}

interface UsageData {
  searchesUsed: number
  searchLimit: number
  isUnlimited: boolean
  subscriptionStatus: string | null
}

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  usage: UsageData | null
  isAdmin: boolean
  isAssociate: boolean
  isLoading: boolean
  signOut: () => Promise<void>
  refetchUsage: () => Promise<void>
  refetchProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createBrowserSupabaseClient()

  const fetchProfile = useCallback(async (userId: string) => {
    // Fetch profile + lifetime report count in parallel
    const [profileRes, reportsRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('role, tier, first_name, beta_expires_at, subscription_status')
        .eq('id', userId)
        .single(),
      supabase
        .from('user_reports')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
    ])

    if (profileRes.data) {
      const data = profileRes.data
      // Map DB tier to UI tier. Beta gets 'beta' if not expired, otherwise 'free'.
      let uiTier: 'free' | 'pro' | 'beta' = 'free'
      if (data.tier === 'beta') {
        uiTier =
          data.beta_expires_at && new Date(data.beta_expires_at) > new Date()
            ? 'beta'
            : 'free'
      } else if (
        data.subscription_status === 'active' &&
        data.tier &&
        data.tier !== 'free'
      ) {
        uiTier = 'pro'
      }

      setProfile({
        role: data.role || 'user',
        tier: uiTier,
        firstName: data.first_name,
        betaExpiresAt: data.beta_expires_at,
        reportsGenerated: reportsRes.count ?? 0,
      })
    }
  }, [supabase])

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/billing/usage')
      if (res.ok) {
        const data = await res.json()
        setUsage({
          searchesUsed: data.searchesUsed,
          searchLimit: data.searchLimit,
          isUnlimited: data.isUnlimited || false,
          subscriptionStatus: data.subscriptionStatus
        })
      }
    } catch {
      // Non-critical - usage indicator can fail silently
    }
  }, [])

  const refetchUsage = useCallback(async () => {
    await fetchUsage()
  }, [fetchUsage])

  useEffect(() => {
    let cancelled = false

    // Get initial user — guarded with timeout + try/catch so a hanging or thrown
    // auth call can never strand isLoading=true (which would leave the app
    // showing a permanent spinner). Timeout covers the ENTIRE chain
    // (getUser + profile + usage) — a hang in any step must not strand
    // isLoading=true. Previously only getUser was guarded.
    const initAuth = async () => {
      const inner = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        setUser(user)
        if (user) {
          await Promise.all([
            fetchProfile(user.id),
            fetchUsage()
          ])
        }
      }
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Auth init timed out')), 10000)
      )
      try {
        await Promise.race([inner(), timeoutPromise])
      } catch (error) {
        console.error('[AuthContext] initial auth check failed:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, session: Session | null) => {
        const newUser = session?.user ?? null
        setUser(newUser)

        if (newUser) {
          await Promise.all([
            fetchProfile(newUser.id),
            fetchUsage()
          ])
        } else {
          setProfile(null)
          setUsage(null)
        }
      }
    )

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase, fetchProfile, fetchUsage])

  const signOut = useCallback(async () => {
    // Race each step against a timeout so a hanging client can never block
    // the caller's navigation. The server endpoint clearing cookies is the
    // only truly critical step (middleware reads cookies on the next request);
    // browser-side localStorage cleanup is best-effort and will resolve on
    // the next page load if it doesn't complete here.
    //
    // Without timeouts, supabase.auth.signOut() can hang silently after a
    // long idle (stale session state) — the caller's await never resolves,
    // the hard-reload navigation never runs, and signOut appears to do
    // nothing even though cookies were already cleared.
    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T | null> =>
      Promise.race([
        p,
        new Promise<null>((resolve) =>
          setTimeout(() => {
            console.warn(`[AuthContext] ${label} timed out after ${ms}ms — proceeding`)
            resolve(null)
          }, ms)
        ),
      ])

    await withTimeout(
      fetch('/api/auth/signout', { method: 'POST' }).catch((e) => {
        console.error('[AuthContext] server signout failed:', e)
        return null
      }),
      3000,
      'server signout'
    )
    await withTimeout(
      supabase.auth.signOut().catch((e: unknown) => {
        console.error('[AuthContext] browser signout failed:', e)
        return null
      }),
      2000,
      'browser signout'
    )
    setUser(null)
    setProfile(null)
    setUsage(null)
  }, [supabase])

  const refetchProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id)
  }, [user, fetchProfile])

  const value: AuthContextType = {
    user,
    profile,
    usage,
    isAdmin: profile?.role === 'admin',
    isAssociate: profile?.role === 'associate',
    isLoading,
    signOut,
    refetchUsage,
    refetchProfile
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Optional hook that doesn't throw if used outside provider (for optional auth scenarios)
export function useOptionalAuth() {
  return useContext(AuthContext)
}
