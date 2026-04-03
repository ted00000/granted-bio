'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { FlaskConical, Activity, Users, Sparkles, Crosshair, User, Building2 } from 'lucide-react'
import type { PersonaType, SearchMode } from '@/lib/chat/types'

interface WelcomeScreenProps {
  onSelectPersona: (persona: PersonaType, initialQuery?: string, searchMode?: SearchMode) => void
  userName?: string | null
  initialLens?: PersonaType
  needsName?: boolean
  onNameSubmit?: (name: string) => Promise<void>
}

// Lens configuration - horizontal pills below search
const LENS_CONFIG: Array<{
  id: PersonaType
  label: string
  searchLabel: string
  icon: typeof FlaskConical
}> = [
  { id: 'researcher', label: 'Projects', searchLabel: 'project', icon: FlaskConical },
  { id: 'bd', label: 'People', searchLabel: 'people', icon: Users },
  { id: 'trials', label: 'Trials', searchLabel: 'trial', icon: Activity },
]

// Search tips for each lens
const SEARCH_TIPS: Record<PersonaType, {
  description: string
  examples: Array<{ label: string; queries: string[] }>
}> = {
  researcher: {
    description: 'Find NIH-funded research by topic, technology, or disease area',
    examples: [
      { label: 'Research topics', queries: ['CAR-T therapy', 'gene editing', 'neural organoids'] },
      { label: 'Disease areas', queries: ["Alzheimer's", 'pancreatic cancer', 'ALS'] },
      { label: 'Technologies', queries: ['CRISPR', 'mass spectrometry', 'single-cell RNA-seq'] },
    ]
  },
  bd: {
    description: 'Find researchers, labs, and organizations working in specific areas',
    examples: [
      { label: 'Researcher names', queries: ['Jane Doe', 'John Doe'] },
      { label: 'Institutions', queries: ['Stanford University', 'MIT', 'Johns Hopkins'] },
      { label: 'Companies', queries: ['Genentech', 'Moderna', 'Illumina'] },
      { label: 'Research areas', queries: ['immunotherapy researchers', 'CRISPR labs'] },
    ]
  },
  trials: {
    description: 'Find clinical trials linked to NIH-funded research',
    examples: [
      { label: 'Conditions', queries: ['ALS', 'scleroderma', 'glioblastoma'] },
      { label: 'Interventions', queries: ['CAR-T', 'gene therapy', 'checkpoint inhibitor'] },
      { label: 'Therapeutic areas', queries: ['oncology trials', 'rare disease treatments'] },
    ]
  },
  investor: {
    description: 'Generate intelligence reports on research landscapes',
    examples: []
  }
}

export function WelcomeScreen({ onSelectPersona, userName, initialLens, needsName, onNameSubmit }: WelcomeScreenProps) {
  const [selectedLens, setSelectedLens] = useState<PersonaType>(initialLens || 'researcher')
  const [searchMode, setSearchMode] = useState<SearchMode>('smart')
  const [searchInput, setSearchInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      onSelectPersona(selectedLens, searchInput.trim(), searchMode)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameInput.trim() || !onNameSubmit) return
    setSavingName(true)
    await onNameSubmit(nameInput.trim())
    setSavingName(false)
  }

  const currentTips = SEARCH_TIPS[selectedLens]

  // Reset to 'smart' if leaving bd persona while 'name' mode is selected
  useEffect(() => {
    if (selectedLens !== 'bd' && searchMode === 'name') {
      setSearchMode('smart')
    }
  }, [selectedLens, searchMode])

  if (needsName) {
    return (
      <div className="h-full flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center px-6 lg:px-8 pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8 min-h-min">
          <div className="max-w-sm mx-auto text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-8">
              What should we call you?
            </h1>
            <form onSubmit={handleSaveName} className="space-y-4">
              <input
                type="text"
                placeholder="Your first name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
                required
                className="w-full px-4 py-3 bg-gray-50 border-0 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200 text-center text-lg"
              />
              <button
                type="submit"
                disabled={savingName || !nameInput.trim()}
                className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
              >
                {savingName ? 'Saving...' : 'Continue'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-8 pt-[calc(4.5rem+env(safe-area-inset-top))] lg:pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:pb-8 min-h-min">

        {/* Centered single column */}
        <div className="max-w-xl w-full mx-auto text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 mb-8">
            {userName ? `Hi ${userName}, what would you like to explore?` : (
              <>Welcome to granted<span className="text-[#E07A5F]">.bio</span></>
            )}
          </h1>

          {/* Search Input */}
          <form onSubmit={handleSubmit} className="mb-4">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 relative">
                <textarea
                  ref={inputRef}
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value.slice(0, 140))}
                  onKeyDown={handleKeyDown}
                  placeholder={`Begin your ${LENS_CONFIG.find(l => l.id === selectedLens)?.searchLabel || 'research'} search here...`}
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

          {/* Lens Bar and Search Mode Toggle */}
          <div className="flex justify-center items-center gap-3 mb-6">
            {/* Persona Pills */}
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
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-[#E07A5F]' : ''}`} strokeWidth={isSelected ? 2 : 1.5} />
                    <span className={isSelected ? 'font-medium' : ''}>{lens.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Search Mode Toggle */}
            <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-full">
              <button
                onClick={() => setSearchMode('smart')}
                className={`
                  flex items-center gap-1.5 px-3 py-2 text-sm rounded-full transition-all
                  ${searchMode === 'smart'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                  }
                `}
                title="Semantic search - finds conceptually related results"
              >
                <Sparkles className={`w-4 h-4 ${searchMode === 'smart' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'smart' ? 2 : 1.5} />
                <span className={searchMode === 'smart' ? 'font-medium' : ''}>Smart</span>
              </button>
              <button
                onClick={() => setSearchMode('standard')}
                className={`
                  flex items-center gap-1.5 px-3 py-2 text-sm rounded-full transition-all
                  ${searchMode === 'standard'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                  }
                `}
                title="Keyword search - finds exact matches for names, IDs, organizations"
              >
                <Crosshair className={`w-4 h-4 ${searchMode === 'standard' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'standard' ? 2 : 1.5} />
                <span className={searchMode === 'standard' ? 'font-medium' : ''}>Exact</span>
              </button>
              {/* Name option - only for People persona */}
              {selectedLens === 'bd' && (
                <button
                  onClick={() => setSearchMode('name')}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 text-sm rounded-full transition-all
                    ${searchMode === 'name'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                    }
                  `}
                  title="Name lookup - search for a specific researcher or organization by name"
                >
                  <div className="flex items-center">
                    <Building2 className={`w-4 h-4 mr-1 ${searchMode === 'name' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'name' ? 2 : 1.5} />
                    <span className={`text-xs ${searchMode === 'name' ? 'text-[#E07A5F]' : 'text-gray-400'}`}>/</span>
                    <User className={`w-4 h-4 ml-0.5 ${searchMode === 'name' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'name' ? 2 : 1.5} />
                  </div>
                  <span className={searchMode === 'name' ? 'font-medium' : ''}>Name</span>
                </button>
              )}
            </div>
          </div>

          {/* Search Tips */}
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-4">{currentTips.description}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {currentTips.examples.map((example, idx) => (
                <div key={idx} className="p-3 bg-gray-50 rounded-lg text-left">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
                    {example.label}
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {example.queries.join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
