'use client'

import { Suspense, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Chat } from '@/components/Chat'
import { AppLayout } from '@/components/AppLayout'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import { useAuth } from '@/contexts/AuthContext'
import type { PersonaType, SearchMode } from '@/lib/chat/types'

interface FilterState {
  primary_category?: string[]
  org_type?: string[]
  state?: string
  quick?: {
    activeOnly?: boolean
    sbirSttrOnly?: boolean
    hasPatents?: boolean
    hasClinicalTrials?: boolean
    hasPublications?: boolean
  }
}

const VALID_PERSONAS: PersonaType[] = ['researcher', 'bd', 'investor', 'trials']

function ChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  // Use the global AuthContext rather than duplicating a per-mount auth fetch.
  // The previous local pattern would re-run supabase.auth.getUser() every time
  // the user navigated INTO /chat (e.g., from /reports via the sidebar Search
  // button) and could strand isLoading=true if the call hung.
  const { user, profile, isLoading, refetchProfile } = useAuth()
  const userId = user?.id ?? null
  const userName = profile?.firstName ?? null
  // Only show the name prompt once we KNOW the profile loaded but is missing
  // a first name. Previously `!profile?.firstName` was true even when profile
  // was null (transient fetch failure on a stale-session return) — falsely
  // showing 'What should we call you?' to users who already had a name set.
  const needsName = !!user && profile !== null && !profile.firstName
  const supabase = createBrowserSupabaseClient()

  const personaParam = searchParams.get('persona')
  const queryParam = searchParams.get('q')
  const lensParam = searchParams.get('lens')
  const piParam = searchParams.get('pi')
  const orgParam = searchParams.get('org')
  const modeParam = searchParams.get('mode')

  // Filter params
  const precisionParam = searchParams.get('precision') as 'low' | 'med' | 'high' | null
  const categoryParam = searchParams.get('category')
  const orgtypeParam = searchParams.get('orgtype')
  const activeParam = searchParams.get('active')
  const sbirParam = searchParams.get('sbir')
  const patentsParam = searchParams.get('patents')
  const trialsParam = searchParams.get('trials')
  const pubsParam = searchParams.get('pubs')
  const stateParam = searchParams.get('state')

  // If pi or org param is provided, automatically use 'bd' persona with that as the query
  const hasPeopleSearch = piParam || orgParam
  const selectedPersona = hasPeopleSearch
    ? 'bd'
    : VALID_PERSONAS.includes(personaParam as PersonaType)
      ? (personaParam as PersonaType)
      : null
  const initialQuery = hasPeopleSearch
    ? (piParam || orgParam || undefined)
    : (queryParam || undefined)
  const initialLens = VALID_PERSONAS.includes(lensParam as PersonaType)
    ? (lensParam as PersonaType)
    : undefined
  const searchMode: SearchMode = modeParam === 'standard' ? 'standard' : modeParam === 'name' ? 'name' : 'smart'

  // Build initial filters from URL params
  const initialPrecision = precisionParam && ['low', 'med', 'high'].includes(precisionParam)
    ? precisionParam
    : undefined

  const initialFilters: FilterState | undefined = (() => {
    const filters: FilterState = {}
    if (categoryParam) {
      filters.primary_category = categoryParam.split(',').filter(Boolean)
    }
    if (orgtypeParam) {
      filters.org_type = orgtypeParam.split(',').filter(Boolean)
    }
    if (stateParam) {
      filters.state = stateParam.toUpperCase()
    }
    const quick: FilterState['quick'] = {}
    if (activeParam === '1') quick.activeOnly = true
    if (sbirParam === '1') quick.sbirSttrOnly = true
    if (patentsParam === '1') quick.hasPatents = true
    if (trialsParam === '1') quick.hasClinicalTrials = true
    if (pubsParam === '1') quick.hasPublications = true
    if (Object.keys(quick).length > 0) {
      filters.quick = quick
    }
    return Object.keys(filters).length > 0 ? filters : undefined
  })()

  // Update URL when filters change (without page reload)
  const handleFiltersChange = useCallback((filters: FilterState, precision: 'low' | 'med' | 'high') => {
    const params = new URLSearchParams(searchParams.toString())

    // Precision
    if (precision !== 'low') {
      params.set('precision', precision)
    } else {
      params.delete('precision')
    }

    // Category
    if (filters.primary_category?.length) {
      params.set('category', filters.primary_category.join(','))
    } else {
      params.delete('category')
    }

    // Org type
    if (filters.org_type?.length) {
      params.set('orgtype', filters.org_type.join(','))
    } else {
      params.delete('orgtype')
    }

    // State
    if (filters.state) {
      params.set('state', filters.state)
    } else {
      params.delete('state')
    }

    // Quick filters
    if (filters.quick?.activeOnly) {
      params.set('active', '1')
    } else {
      params.delete('active')
    }
    if (filters.quick?.sbirSttrOnly) {
      params.set('sbir', '1')
    } else {
      params.delete('sbir')
    }
    if (filters.quick?.hasPatents) {
      params.set('patents', '1')
    } else {
      params.delete('patents')
    }
    if (filters.quick?.hasClinicalTrials) {
      params.set('trials', '1')
    } else {
      params.delete('trials')
    }
    if (filters.quick?.hasPublications) {
      params.set('pubs', '1')
    } else {
      params.delete('pubs')
    }

    router.replace(`/chat?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const handleNameSubmit = async (name: string) => {
    if (!userId) return
    await supabase
      .from('user_profiles')
      .update({ first_name: name })
      .eq('id', userId)
    // Refresh the global profile so the name prompt closes app-wide.
    await refetchProfile()
  }

  const handlePersonaChange = (persona: PersonaType, initialQuery?: string, mode?: SearchMode) => {
    const modeParam = mode && mode !== 'smart' ? `&mode=${mode}` : ''
    if (initialQuery) {
      router.push(`/chat?persona=${persona}&q=${encodeURIComponent(initialQuery)}${modeParam}`)
    } else {
      router.push(`/chat?persona=${persona}${modeParam}`)
    }
  }

  return (
    <AppLayout
      currentPersona={selectedPersona}
      onPersonaChange={handlePersonaChange}
      userName={userName}
    >
      {selectedPersona ? (
        <Chat
          persona={selectedPersona}
          initialQuery={initialQuery}
          searchMode={searchMode}
          initialFilters={initialFilters}
          initialPrecision={initialPrecision}
          onFiltersChange={handleFiltersChange}
        />
      ) : (
        // Render WelcomeScreen immediately rather than gating on isLoading.
        // The screen's primary content (persona pills, search input, examples)
        // doesn't depend on auth — only the personalized greeting and the
        // name-capture check do, and those resolve lazily as profile loads.
        // Previously a new-tab visit showed a full-screen spinner for several
        // seconds while initAuth completed.
        <WelcomeScreen
          onSelectPersona={handlePersonaChange}
          userName={userName}
          initialLens={initialLens}
          needsName={needsName}
          onNameSubmit={handleNameSubmit}
        />
      )}
    </AppLayout>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
      </div>
    }>
      <ChatContent />
    </Suspense>
  )
}
