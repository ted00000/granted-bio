'use client'

import { Search, TrendingUp, Users, Activity } from 'lucide-react'
import type { PersonaType } from '@/lib/chat/types'

interface WelcomeScreenProps {
  onSelectPersona: (persona: PersonaType) => void
  userName?: string | null
}

const PERSONA_OPTIONS: Array<{
  id: PersonaType
  title: string
  subtitle: string
  description: string
  icon: typeof Search
}> = [
  {
    id: 'researcher',
    title: 'Research',
    subtitle: 'What science is being funded?',
    description: 'Topic deep dives, funded projects, publications',
    icon: Search
  },
  {
    id: 'investor',
    title: 'Market',
    subtitle: 'How big is the opportunity?',
    description: 'Macro intelligence, funding trends, competitive analysis',
    icon: TrendingUp
  },
  {
    id: 'trials',
    title: 'Trials',
    subtitle: "What's in development?",
    description: 'Clinical pipelines, phases, trial tracking',
    icon: Activity
  },
  {
    id: 'bd',
    title: 'Leads',
    subtitle: 'Who should I talk to?',
    description: 'Find companies, contacts, partnership targets',
    icon: Users
  }
]

export function WelcomeScreen({ onSelectPersona, userName }: WelcomeScreenProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
          {userName ? `Hi ${userName}, what would you like to explore?` : (
            <>Welcome to granted<span className="text-[#E07A5F]">.bio</span></>
          )}
        </h1>
        <p className="text-gray-500 mb-10">
          {userName ? 'Select a mode to get started' : 'Your AI-powered life science intelligence platform'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PERSONA_OPTIONS.map(option => {
            const Icon = option.icon
            return (
              <button
                key={option.id}
                onClick={() => onSelectPersona(option.id)}
                className="group p-6 bg-white rounded-xl border border-gray-100 hover:border-[#E07A5F] hover:shadow-lg transition-all text-left"
              >
                <div className="text-gray-400 mb-4 group-hover:text-[#E07A5F] transition-colors">
                  <Icon className="w-8 h-8" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {option.title}
                </h3>
                <p className="text-sm text-[#E07A5F] mb-2">
                  &ldquo;{option.subtitle}&rdquo;
                </p>
                <p className="text-sm text-gray-500">
                  {option.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
