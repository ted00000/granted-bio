'use client'

import type { PersonaType } from '@/lib/chat/types'
import { PERSONA_METADATA } from '@/lib/chat/prompts'

interface PersonaSelectorProps {
  onSelect: (persona: PersonaType) => void
}

export function PersonaSelector({ onSelect }: PersonaSelectorProps) {
  const personas: PersonaType[] = ['researcher', 'bd', 'investor']

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold text-blue-600">granted.bio</span>
            <div className="text-sm text-gray-500">
              Life Science Grant Intelligence
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
            What brings you here today?
          </h1>
          <p className="text-xl text-gray-600 mb-12">
            Choose your role for a personalized AI-powered search experience
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {personas.map(persona => {
              const meta = PERSONA_METADATA[persona]
              return (
                <button
                  key={persona}
                  onClick={() => onSelect(persona)}
                  className="group p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:shadow-lg transition-all text-left"
                >
                  <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">
                    {meta.icon}
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    {meta.title}
                  </h2>
                  <p className="text-lg text-blue-600 mb-3">
                    &ldquo;{meta.subtitle}&rdquo;
                  </p>
                  <p className="text-sm text-gray-500">
                    {meta.description}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-2xl font-bold text-blue-600">128K+</div>
              <div className="text-sm text-gray-500">NIH Projects</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-2xl font-bold text-green-600">46K+</div>
              <div className="text-sm text-gray-500">Patents</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-2xl font-bold text-purple-600">203K+</div>
              <div className="text-sm text-gray-500">Publications</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="text-2xl font-bold text-orange-600">38K+</div>
              <div className="text-sm text-gray-500">Clinical Trials</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-6">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500">
            Data sourced from NIH RePORTER FY2024-2025.
            AI-powered classification and semantic search.
          </p>
        </div>
      </footer>
    </div>
  )
}
