'use client'

import type { PersonaType } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'

interface PersonaSelectorProps {
  onSelect: (persona: PersonaType) => void
}

export function PersonaSelector({ onSelect }: PersonaSelectorProps) {
  const personas: PersonaType[] = ['researcher', 'bd', 'investor']

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="px-6 py-4">
        <nav className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </span>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 mb-3">
              What brings you here today?
            </h1>
            <p className="text-lg text-gray-500">
              Choose your role for a personalized search experience
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {personas.map(persona => {
              const meta = PERSONA_METADATA[persona]
              return (
                <button
                  key={persona}
                  onClick={() => onSelect(persona)}
                  className="group p-6 bg-white rounded-xl border border-gray-100 hover:border-[#E07A5F] hover:shadow-md transition-all text-left"
                >
                  <div className="text-3xl mb-3">
                    {meta.icon}
                  </div>
                  <h2 className="text-lg font-medium text-gray-900 mb-1">
                    {meta.title}
                  </h2>
                  <p className="text-sm text-[#E07A5F] mb-2">
                    &ldquo;{meta.subtitle}&rdquo;
                  </p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {meta.description}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
