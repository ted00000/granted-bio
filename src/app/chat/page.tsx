'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Chat } from '@/components/Chat'
import { AppLayout } from '@/components/AppLayout'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { PersonaType } from '@/lib/chat/types'

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

  const handlePersonaChange = (persona: PersonaType, initialQuery?: string) => {
    if (initialQuery) {
      router.push(`/chat?persona=${persona}&q=${encodeURIComponent(initialQuery)}`)
    } else {
      router.push(`/chat?persona=${persona}`)
    }
  }

  return (
    <AppLayout
      currentPersona={selectedPersona}
      onPersonaChange={handlePersonaChange}
      userName={userName}
    >
      {selectedPersona ? (
        <Chat persona={selectedPersona} initialQuery={initialQuery} />
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
