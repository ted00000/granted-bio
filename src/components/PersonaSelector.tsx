'use client'

import Link from 'next/link'
import type { IntentType, PersonaType } from '@/lib/chat/types'
import { INTENT_TO_PERSONA } from '@/lib/chat/types'
import { Search, TrendingUp, Users, Activity } from 'lucide-react'

interface PersonaSelectorProps {
  onSelect: (persona: PersonaType) => void
}

const intents: {
  id: IntentType
  title: string
  question: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    id: 'research',
    title: 'Research',
    question: 'What science is being funded?',
    description: 'Topic deep dives, funded projects, publications',
    icon: <Search className="w-6 h-6" strokeWidth={1.5} />,
  },
  {
    id: 'market',
    title: 'Market',
    question: 'Who are the key players?',
    description: 'Competitive landscape, trends, segment mapping',
    icon: <TrendingUp className="w-6 h-6" strokeWidth={1.5} />,
  },
  {
    id: 'leads',
    title: 'Leads',
    question: 'Who should I talk to?',
    description: 'Find companies, contacts, partnership targets',
    icon: <Users className="w-6 h-6" strokeWidth={1.5} />,
  },
  {
    id: 'trials',
    title: 'Trials',
    question: "What's in development?",
    description: 'Clinical pipelines, phases, trial tracking',
    icon: <Activity className="w-6 h-6" strokeWidth={1.5} />,
  },
]

export function PersonaSelector({ onSelect }: PersonaSelectorProps) {
  const handleSelect = (intent: IntentType) => {
    const persona = INTENT_TO_PERSONA[intent]
    onSelect(persona)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="px-6 py-4">
        <nav className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-2xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </span>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-3xl mx-auto w-full">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 mb-3">
              What are you looking for?
            </h1>
            <p className="text-lg text-gray-500">
              Choose your focus to get started
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {intents.map(intent => (
              <button
                key={intent.id}
                onClick={() => handleSelect(intent.id)}
                className="group p-5 bg-white rounded-xl border border-gray-100 hover:border-[#E07A5F] hover:shadow-md transition-all text-left"
              >
                <div className="text-gray-400 mb-3 group-hover:text-[#E07A5F] transition-colors">
                  {intent.icon}
                </div>
                <h2 className="text-base font-medium text-gray-900 mb-1">
                  {intent.title}
                </h2>
                <p className="text-sm text-[#E07A5F] mb-2">
                  &ldquo;{intent.question}&rdquo;
                </p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  {intent.description}
                </p>
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-gray-100">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data sourced from NIH RePORTER
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a href="mailto:hello@granted.bio" className="hover:text-gray-600 transition-colors">
              Contact
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
