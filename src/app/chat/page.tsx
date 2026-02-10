'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Chat } from '@/components/Chat'
import { PersonaSelector } from '@/components/PersonaSelector'
import type { PersonaType } from '@/lib/chat/types'

const VALID_PERSONAS: PersonaType[] = ['researcher', 'bd', 'investor', 'trials']

function ChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const personaParam = searchParams.get('persona')
  const selectedPersona = VALID_PERSONAS.includes(personaParam as PersonaType)
    ? (personaParam as PersonaType)
    : null

  const handleSelect = (persona: PersonaType) => {
    router.push(`/chat?persona=${persona}`)
  }

  const handleBack = () => {
    router.push('/chat')
  }

  if (!selectedPersona) {
    return <PersonaSelector onSelect={handleSelect} />
  }

  return (
    <Chat
      persona={selectedPersona}
      onBack={handleBack}
    />
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <ChatContent />
    </Suspense>
  )
}
