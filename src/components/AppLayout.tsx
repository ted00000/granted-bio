'use client'

import { Sidebar } from './Sidebar'
import type { PersonaType } from '@/lib/chat/types'

interface AppLayoutProps {
  children: React.ReactNode
  currentPersona?: PersonaType | null
  onPersonaChange?: (persona: PersonaType) => void
  userName?: string | null
}

export function AppLayout({ children, currentPersona, onPersonaChange, userName }: AppLayoutProps) {
  return (
    <div className="fixed inset-0 flex bg-white overflow-hidden">
      <Sidebar
        currentPersona={currentPersona}
        onPersonaChange={onPersonaChange}
        userName={userName}
      />
      <main className="flex-1 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
