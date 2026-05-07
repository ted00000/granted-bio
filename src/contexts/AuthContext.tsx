'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

interface UserProfile {
  role: 'user' | 'admin' | 'associate'
  tier: 'free' | 'pro'
  firstName: string | null
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
    const { data } = await supabase
      .from('user_profiles')
      .select('role, tier, first_name')
      .eq('id', userId)
      .single()

    if (data) {
      setProfile({
        role: data.role || 'user',
        tier: data.tier || 'free',
        firstName: data.first_name
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
    // showing a permanent spinner).
    const initAuth = async () => {
      try {
        const userPromise = supabase.auth.getUser()
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Auth check timed out')), 8000)
        )
        const { data: { user } } = await Promise.race([userPromise, timeoutPromise])
        if (cancelled) return
        setUser(user)

        if (user) {
          await Promise.all([
            fetchProfile(user.id),
            fetchUsage()
          ])
        }
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
    await supabase.auth.signOut()
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
