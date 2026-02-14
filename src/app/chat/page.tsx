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
  const supabase = createBrowserSupabaseClient()

  const personaParam = searchParams.get('persona')
  const selectedPersona = VALID_PERSONAS.includes(personaParam as PersonaType)
    ? (personaParam as PersonaType)
    : null

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('first_name, full_name')
          .eq('id', user.id)
          .single()

        if (profile) {
          setUserName(profile.first_name || profile.full_name?.split(' ')[0] || user.email?.split('@')[0] || null)
        }
      }
    }
    fetchUser()
  }, [supabase])

  const handlePersonaChange = (persona: PersonaType) => {
    router.push(`/chat?persona=${persona}`)
  }

  return (
    <AppLayout
      currentPersona={selectedPersona}
      onPersonaChange={handlePersonaChange}
      userName={userName}
    >
      {selectedPersona ? (
        <Chat persona={selectedPersona} />
      ) : (
        <WelcomeScreen onSelectPersona={handlePersonaChange} />
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
