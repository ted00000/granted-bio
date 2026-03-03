'use client'

import { Search, Activity, Users, FileText, Lock } from 'lucide-react'
import type { PersonaType } from '@/lib/chat/types'

interface WelcomeScreenProps {
  onSelectPersona: (persona: PersonaType) => void
  userName?: string | null
}

const SEARCH_OPTIONS: Array<{
  id: PersonaType
  label: string
  title: string
  subtitle: string
  description: string
  icon: typeof Search
}> = [
  {
    id: 'researcher',
    label: 'What',
    title: 'Research',
    subtitle: 'What science is being funded?',
    description: 'Topic deep dives, funded projects, publications',
    icon: Search
  },
  {
    id: 'trials',
    label: 'How',
    title: 'Trials',
    subtitle: 'How is it progressing?',
    description: 'Clinical pipelines, phases, trial tracking',
    icon: Activity
  },
  {
    id: 'bd',
    label: 'Who',
    title: 'People',
    subtitle: 'Who is working on this?',
    description: 'Find researchers, PIs, institutions',
    icon: Users
  }
]

export function WelcomeScreen({ onSelectPersona, userName }: WelcomeScreenProps) {
  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-8 pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8 min-h-min">
        <div className="max-w-2xl w-full mx-auto text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
            {userName ? `Hi ${userName}, what would you like to explore?` : (
              <>Welcome to granted<span className="text-[#E07A5F]">.bio</span></>
            )}
          </h1>
          <p className="text-gray-500 mb-10">
            {userName ? 'Select a mode to get started' : 'Your AI-powered life science intelligence platform'}
          </p>

          {/* Search Modes */}
          <div className="mb-8">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Search</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {SEARCH_OPTIONS.map(option => {
                const Icon = option.icon
                return (
                  <button
                    key={option.id}
                    onClick={() => onSelectPersona(option.id)}
                    className="group p-5 bg-white rounded-xl border border-gray-100 hover:border-[#E07A5F] hover:shadow-lg transition-all text-left"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-gray-400 group-hover:text-[#E07A5F] transition-colors">
                        <Icon className="w-6 h-6" strokeWidth={1.5} />
                      </div>
                      <span className="text-xs font-medium text-gray-400 uppercase">{option.label}</span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900 mb-1">
                      {option.title}
                    </h3>
                    <p className="text-sm text-[#E07A5F] mb-1">
                      &ldquo;{option.subtitle}&rdquo;
                    </p>
                    <p className="text-xs text-gray-500">
                      {option.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Intelligence Reports - Premium */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Analyze</p>
            <button
              onClick={() => onSelectPersona('investor')}
              className="group w-full p-5 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 hover:border-[#E07A5F] hover:shadow-lg transition-all text-left relative"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-gray-400 group-hover:text-[#E07A5F] transition-colors">
                      <FileText className="w-6 h-6" strokeWidth={1.5} />
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <Lock className="w-3 h-3" />
                      Premium
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    Intelligence Reports
                  </h3>
                  <p className="text-sm text-[#E07A5F] mb-1">
                    &ldquo;Generate a landscape analysis&rdquo;
                  </p>
                  <p className="text-xs text-gray-500">
                    Synthesize funding, patents, trials, and publications into comprehensive reports
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
