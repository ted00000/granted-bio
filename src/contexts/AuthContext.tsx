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
  /**
   * True when there IS an authenticated user (JWT cookie is valid,
   * middleware let us in) but the client-side profile fetch has
   * exhausted its retry budget without success. UI should surface a
   * "session needs refresh" affordance rather than silently rendering
   * as unprivileged — this is the "nether state" (server sees admin,
   * client sees no profile, admin links vanish). Reload usually
   * resolves it.
   */
  profileLoadFailed: boolean
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
  const [profileLoadFailed, setProfileLoadFailed] = useState(false)

  const supabase = createBrowserSupabaseClient()

  // Fetch the user_profiles row + lifetime report count. Returns
  // { found: true } on success, { found: false } when the row is
  // definitively missing (PostgREST error code PGRST116 = "no rows"),
  // and { found: 'error' } for transient failures (network, perm).
  //
  // The three failure modes this retry policy handles:
  //   - Fresh-signup commit lag. Supabase auth trigger inserts
  //     user_profiles asynchronously; a brief window can return
  //     PGRST116 on the first read but succeed on retry.
  //   - Token-refresh race (the "nether state" bug). When Supabase
  //     auto-refreshes the JWT (every ~55min), there's a small window
  //     where the client's cached token is stale. RLS uses auth.uid()
  //     from the JWT to gate row visibility, so a stale JWT returns
  //     zero rows — indistinguishable from a truly-missing row without
  //     forcing a fresh session. We call refreshSession() before the
  //     final PGRST116 retry to distinguish real ghost sessions from
  //     this race.
  //   - Transient network / cold-start / connection reset. Previously
  //     these hit `{found: 'error'}` and had NO retry path — one bad
  //     network moment left the user stranded with profile=null (admin
  //     link vanishes, "nether state") until manual reload. Now all
  //     transient failures share the same retry backoff.
  //
  // Callers use the definitive `{found: false}` result (real ghost —
  // JWT valid but auth.users row deleted) to trigger sign-out cleanup.
  // Anything else keeps the session intact.
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

      // Attempt 1: fast path. Most sessions succeed here.
      let result = await tryOnce()
      if (result.found === true) return result

      // Retry schedule: 500ms, 1.2s, 2s (3 additional attempts). Applies
      // to both PGRST116 (row missing) and transient errors — same
      // backoff, different meanings. On the final attempt, if we're
      // still seeing PGRST116, force a session refresh to rule out a
      // stale-JWT race before declaring ghost. If refresh throws, the
      // session is dead and we let the ghost path take over.
      const BACKOFFS_MS = [500, 1200, 2000]
      for (let i = 0; i < BACKOFFS_MS.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFFS_MS[i]))

        const isLastAttempt = i === BACKOFFS_MS.length - 1
        if (isLastAttempt && result.found === false) {
          try {
            await supabase.auth.refreshSession()
          } catch (e) {
            console.warn(
              '[AuthContext] refreshSession failed before ghost declaration:',
              e
            )
          }
        }

        result = await tryOnce()
        if (result.found === true) return result
      }
      return result
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
        setProfileLoadFailed(false)
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
          } else if (profileResult.found === 'error') {
            // Transient failure survived all retries. Session is valid
            // but profile couldn't be hydrated — flag it so UI can
            // surface a reload affordance instead of silently rendering
            // the nether state (admin link vanishes, tier reads free).
            console.warn(
              `[AuthContext] profile load failed for ${user.id} after retries — flagging profileLoadFailed`
            )
            if (!cancelled) setProfileLoadFailed(true)
          } else if (!cancelled) {
            setProfileLoadFailed(false)
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
          setProfileLoadFailed(false)
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
          } else if (profileResult.found === 'error') {
            console.warn(
              `[AuthContext] profile load failed for ${newUser.id} after retries — flagging profileLoadFailed`
            )
            if (!cancelled) setProfileLoadFailed(true)
          } else if (!cancelled) {
            setProfileLoadFailed(false)
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
    setProfileLoadFailed(false)
  }, [supabase])

  const refetchProfile = useCallback(async () => {
    if (!user) return
    const result = await fetchProfile(user.id)
    // Keep profileLoadFailed in sync when callers manually retry —
    // otherwise a successful retry would leave the flag stuck at true
    // and the reload prompt would stay visible even after recovery.
    if (result.found === true) {
      setProfileLoadFailed(false)
    } else if (result.found === 'error') {
      setProfileLoadFailed(true)
    }
    // {found: false} keeps the flag as-is; the caller (or the auth
    // state machine) will trigger ghost cleanup separately if needed.
  }, [user, fetchProfile])

  const value: AuthContextType = {
    user,
    profile,
    usage,
    isAdmin: profile?.role === 'admin',
    isAssociate: profile?.role === 'associate',
    isLoading,
    profileLoadFailed,
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
