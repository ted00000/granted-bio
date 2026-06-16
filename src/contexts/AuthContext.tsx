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

  // Fetch the user_profiles row + lifetime report count. Returns
  // { found: true } on success, { found: false } when the row is
  // definitively missing (PostgREST error code PGRST116 = "no rows"),
  // and { found: 'error' } for transient failures (network, perm).
  //
  // Callers use the missing case to detect ghost sessions — cookies
  // whose underlying auth.users row was deleted (cascade-removing
  // user_profiles) but whose JWT is still valid until expiry.
  //
  // For a brand-new sign-up there's a brief window between the
  // Supabase auth trigger inserting user_profiles and that row being
  // visible to client reads (replication lag / pooler caching /
  // transaction visibility). To avoid misclassifying that race as a
  // ghost, we retry once with a short delay on the first PGRST116.
  // A real ghost stays missing on the retry; a new sign-up resolves.
  const fetchProfile = useCallback(
    async (
      userId: string
    ): Promise<{ found: true } | { found: false } | { found: 'error' }> => {
      const tryOnce = async (): Promise<
        { found: true } | { found: false } | { found: 'error' }
      > => {
        const [profileRes, reportsRes] = await Promise.all([
          supabase
            .from('user_profiles')
            .select('role, tier, first_name, beta_expires_at, subscription_status')
            .eq('id', userId)
            .single(),
          supabase
            .from('user_reports')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId),
        ])

        if (profileRes.data) {
          const data = profileRes.data
          // Map DB tier to UI tier. Beta gets 'beta' if not expired, otherwise 'free'.
          // Role override: admin and associate roles always map to 'pro' regardless
          // of DB tier — associates carry DB tier='free' (no Stripe subscription)
          // but get pro-equivalent access (500 searches/mo, expanded results).
          // Without this override the sidebar would render the free-tier "0/10"
          // search counter for associates.
          let uiTier: 'free' | 'pro' | 'beta' = 'free'
          if (data.role === 'admin' || data.role === 'associate') {
            uiTier = 'pro'
          } else if (data.tier === 'beta') {
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
          return { found: true }
        }

        // PostgREST returns code PGRST116 when .single() finds no rows.
        // Any other error code is a transient failure (network, RLS, etc.)
        // and should not trigger a sign-out.
        if (profileRes.error?.code === 'PGRST116') {
          return { found: false }
        }
        return { found: 'error' }
      }

      const first = await tryOnce()
      if (first.found !== false) return first

      // First read returned PGRST116. Retry once after a short delay
      // to absorb a fresh-signup commit lag before declaring ghost.
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return await tryOnce()
    },
    [supabase]
  )

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

    // Clear a ghost session — a JWT cookie whose underlying
    // auth.users row no longer exists (most common after a test-user
    // delete in the Supabase dashboard, but also possible if an admin
    // hard-deletes someone). The JWT itself is valid until expiry, so
    // getUser() happily returns a user object, but every authed query
    // fails because the cascade deleted the user_profiles row. Left
    // unhandled, the app behaves as if the user is logged in (CTAs
    // route to the dashboard, etc.) even though every action will
    // actually fail. Signing out forces the cookie to clear and the
    // next render shows the real logged-out UI.
    const cleanupGhostSession = async () => {
      try {
        await fetch('/api/auth/signout', { method: 'POST' })
      } catch (e) {
        console.error('[AuthContext] ghost cleanup: server signout failed:', e)
      }
      try {
        await supabase.auth.signOut()
      } catch (e) {
        console.error('[AuthContext] ghost cleanup: browser signout failed:', e)
      }
      if (!cancelled) {
        setUser(null)
        setProfile(null)
        setUsage(null)
      }
    }

    // Get initial user — guarded with timeout + try/catch so a hanging or thrown
    // auth call can never strand isLoading=true (which would leave the app
    // showing a permanent spinner). Timeout covers getUser + fetchProfile,
    // not fetchUsage. fetchUsage was previously in the critical path which
    // made isLoading wait on a Vercel cold-start of /api/billing/usage —
    // observed in production as a 10s spinner on first page load. Usage is
    // only consumed by the sidebar search counter / upsell prompts; nothing
    // in the auth or checkout flow needs it to be ready synchronously, so
    // we fire it as a side effect and let it populate state when it
    // resolves.
    const initAuth = async () => {
      const inner = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (cancelled) return
        setUser(user)
        if (user) {
          fetchUsage()
          const profileResult = await fetchProfile(user.id)
          if (profileResult.found === false) {
            console.warn(
              `[AuthContext] ghost session detected for ${user.id} — signing out`
            )
            await cleanupGhostSession()
          }
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

    // Listen for auth changes. Only clear profile/usage on an explicit
    // SIGNED_OUT — Supabase fires INITIAL_SESSION / TOKEN_REFRESHED /
    // USER_UPDATED through the same channel and any of them can briefly
    // arrive with session=null during a token-refresh race. The
    // previous version would null out profile on that transient null,
    // even though the user was still authenticated, causing the UI to
    // flip from "Hi {firstName}" back to the anonymous welcome screen
    // mid-session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          setUsage(null)
          return
        }

        const newUser = session?.user ?? null
        if (newUser) {
          setUser(newUser)
          fetchUsage()
          const profileResult = await fetchProfile(newUser.id)
          if (profileResult.found === false) {
            console.warn(
              `[AuthContext] ghost session detected for ${newUser.id} — signing out`
            )
            await cleanupGhostSession()
          }
        }
        // Other events without a session (rare in practice) are
        // intentionally ignored — initAuth or a later SIGNED_IN /
        // INITIAL_SESSION will populate state.
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
