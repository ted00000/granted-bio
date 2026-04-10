'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Chat } from '@/components/Chat'
import { AppLayout } from '@/components/AppLayout'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { PersonaType, SearchMode } from '@/lib/chat/types'

interface FilterState {
  primary_category?: string[]
  org_type?: string[]
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
  const [userName, setUserName] = useState<string | null>(null)
  const [needsName, setNeedsName] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
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

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('first_name, full_name')
          .eq('id', user.id)
          .single()

        if (profile) {
          if (profile.first_name) {
            setUserName(profile.first_name)
          } else {
            setNeedsName(true)
          }
        }
      }
      setIsLoading(false)
    }
    fetchUser()
  }, [supabase])

  const handleNameSubmit = async (name: string) => {
    if (!userId) return
    await supabase
      .from('user_profiles')
      .update({ first_name: name })
      .eq('id', userId)
    setUserName(name)
    setNeedsName(false)
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
      ) : isLoading ? (
        <div className="h-full flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
        </div>
      ) : (
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
