'use client'

import { useState } from 'react'
import { Chat } from '@/components/Chat'
import { PersonaSelector } from '@/components/PersonaSelector'
import type { PersonaType } from '@/lib/chat/types'

export default function ChatPage() {
  const [selectedPersona, setSelectedPersona] = useState<PersonaType | null>(null)

  if (!selectedPersona) {
    return <PersonaSelector onSelect={setSelectedPersona} />
  }

  return (
    <Chat
      persona={selectedPersona}
      onBack={() => setSelectedPersona(null)}
    />
  )
}
