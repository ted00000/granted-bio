'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { Search, Activity, Users, FileText, Lock } from 'lucide-react'
import type { PersonaType } from '@/lib/chat/types'

interface WelcomeScreenProps {
  onSelectPersona: (persona: PersonaType, initialQuery?: string) => void
  userName?: string | null
}

// Lens configuration - horizontal pills below search
const LENS_CONFIG: Array<{
  id: PersonaType
  label: string
  icon: typeof Search
}> = [
  { id: 'researcher', label: 'Projects', icon: Search },
  { id: 'bd', label: 'People', icon: Users },
  { id: 'trials', label: 'Trials', icon: Activity },
]

export function WelcomeScreen({ onSelectPersona, userName }: WelcomeScreenProps) {
  const [selectedLens, setSelectedLens] = useState<PersonaType>('researcher')
  const [searchInput, setSearchInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      onSelectPersona(selectedLens, searchInput.trim())
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-8 pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8 min-h-min">
        <div className="max-w-xl w-full mx-auto text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-2">
            {userName ? `Hi ${userName}, what would you like to explore?` : (
              <>Welcome to granted<span className="text-[#E07A5F]">.bio</span></>
            )}
          </h1>
          <p className="text-gray-500 mb-8">
            {userName ? 'Search NIH-funded research' : 'Your AI-powered life science intelligence platform'}
          </p>

          {/* Search Input */}
          <form onSubmit={handleSubmit} className="mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 relative">
                <textarea
                  ref={inputRef}
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value.slice(0, 140))}
                  onKeyDown={handleKeyDown}
                  placeholder="Search for a research topic..."
                  rows={1}
                  maxLength={140}
                  className="w-full px-4 py-3.5 bg-gray-50 border-0 rounded-xl resize-none text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-base"
                  style={{ maxHeight: '120px' }}
                />
                {searchInput.length > 100 && (
                  <span className={`absolute right-3 bottom-2 text-xs ${searchInput.length >= 140 ? 'text-red-400' : 'text-gray-400'}`}>
                    {140 - searchInput.length}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={!searchInput.trim() || searchInput.length > 140}
                className="flex-shrink-0 p-3.5 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-40 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>

          {/* Lens Bar */}
          <div className="flex justify-center mb-12">
            <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-full">
              {LENS_CONFIG.map(lens => {
                const isSelected = selectedLens === lens.id
                const Icon = lens.icon
                return (
                  <button
                    key={lens.id}
                    onClick={() => setSelectedLens(lens.id)}
                    className={`
                      flex items-center gap-1.5 px-4 py-2 text-sm rounded-full transition-all
                      ${isSelected
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" strokeWidth={isSelected ? 2 : 1.5} />
                    <span className={isSelected ? 'font-medium' : ''}>{lens.label}</span>
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
