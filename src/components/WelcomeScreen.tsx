'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { FlaskConical, Activity, Users, Sparkles, Crosshair, User, Building2, Lightbulb } from 'lucide-react'
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

// Dynamic help-box content for each (persona × mode) combination.
// The box replaces the previous static example tiles — those taught WHAT
// kind of query runs, not WHEN to pick which combination. Each entry
// below explains what the combination actually does, when to reach for
// it, and shows one clickable example that drops into the input.
//
// Not every mode applies to every persona. "name" (direct profile
// lookup) is People-only — the mode-selector hides the Name button for
// other personas and auto-switches to "smart" if the lens changes
// away from People (see effect below).
interface ComboHelp {
  what: string
  when: string
  example: string
}
const MODE_HELP: Record<PersonaType, Partial<Record<SearchMode, ComboHelp>>> = {
  researcher: {
    smart: {
      what: 'Searches project titles and abstracts by meaning, so paraphrases and related terms match.',
      when: "Use when the exact wording may vary or you're not sure of the terminology.",
      example: 'CAR-T manufacturing scalability',
    },
    standard: {
      what: 'Matches your exact words in titles, abstracts, and project numbers. No synonym expansion.',
      when: 'Use when you know a specific drug name, acronym, or project number.',
      example: 'PSMA-617',
    },
  },
  bd: {
    smart: {
      what: 'Finds researchers, labs, or organizations by the topics they work on.',
      when: "Use when you're searching by research area, not a specific person or org.",
      example: 'immunotherapy researchers at Stanford',
    },
    standard: {
      what: 'Matches exact PI names and organization names appearing in project records.',
      when: 'Use when you know the exact spelling of a person or organization.',
      example: 'Jennifer Doudna',
    },
    name: {
      what: 'Direct profile lookup for one person or one organization. No topic search; just the full record.',
      when: 'Use when you want everything we have on a specific name and nothing else.',
      example: 'Genentech',
    },
  },
  trials: {
    smart: {
      what: 'Semantic search across trial titles, conditions, and interventions — paraphrases match.',
      when: "Use when you're searching by disease area or treatment approach.",
      example: 'gene therapy for sickle cell',
    },
    standard: {
      what: 'Matches exact terms including NCT identifier, condition name, or intervention name.',
      when: 'Use when you have the NCT ID or an exact clinical term.',
      example: 'NCT04381832',
    },
  },
  investor: {},
}

// Human-readable labels for the help-box header. Mode internal values
// ('smart' / 'standard' / 'name') stay as-is in the data layer and API
// — only the display label changes to something less jargon-y.
const MODE_LABELS: Record<SearchMode, string> = {
  smart: 'Describe',
  standard: 'Exact',
  name: 'Name',
}

// Icons for the help-box pills. Same icons as the actual mode-selector
// buttons above the box so the user sees the same visual element
// mirrored back — reinforces the connection between the pill they
// clicked and what the box explains. For "name" we show just User
// (single icon reads cleaner at pill scale than the Building2 / User
// pair used on the selector button).
const MODE_ICONS: Record<SearchMode, typeof FlaskConical> = {
  smart: Sparkles,
  standard: Crosshair,
  name: User,
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

  const currentHelp = MODE_HELP[selectedLens]?.[searchMode]

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
              <label htmlFor="name-input" className="sr-only">Your first name</label>
              <input
                id="name-input"
                type="text"
                placeholder="Your first name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                autoFocus
                required
                aria-required="true"
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
          <form onSubmit={handleSubmit} className="mb-4" role="search">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 relative">
                <label htmlFor="search-input" className="sr-only">
                  Search {LENS_CONFIG.find(l => l.id === selectedLens)?.label || 'projects'}
                </label>
                <textarea
                  id="search-input"
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
                aria-label="Submit search"
                className="flex-shrink-0 p-3.5 bg-[#E07A5F] text-white rounded-xl hover:bg-[#C96A4F] disabled:opacity-40 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </form>

          {/* Lens Bar and Search Mode Toggle */}
          <div className="flex flex-col sm:flex-row justify-center items-center gap-2 sm:gap-3 mb-6">
            {/* Persona Pills */}
            <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-full" role="tablist" aria-label="Search type">
              {LENS_CONFIG.map(lens => {
                const isSelected = selectedLens === lens.id
                const Icon = lens.icon
                return (
                  <button
                    key={lens.id}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedLens(lens.id)}
                    className={`
                      flex items-center gap-1.5 px-4 py-2 text-sm rounded-full transition-all
                      ${isSelected
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                      }
                    `}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-[#E07A5F]' : ''}`} strokeWidth={isSelected ? 2 : 1.5} aria-hidden="true" />
                    <span className={isSelected ? 'font-medium' : ''}>{lens.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Search Mode Toggle */}
            <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-full" role="tablist" aria-label="Search mode">
              <button
                role="tab"
                aria-selected={searchMode === 'smart'}
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
                <Sparkles className={`w-4 h-4 ${searchMode === 'smart' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'smart' ? 2 : 1.5} aria-hidden="true" />
                <span className={searchMode === 'smart' ? 'font-medium' : ''}>{MODE_LABELS.smart}</span>
              </button>
              <button
                role="tab"
                aria-selected={searchMode === 'standard'}
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
                <Crosshair className={`w-4 h-4 ${searchMode === 'standard' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'standard' ? 2 : 1.5} aria-hidden="true" />
                <span className={searchMode === 'standard' ? 'font-medium' : ''}>{MODE_LABELS.standard}</span>
              </button>
              {/* Name option - only for People persona */}
              {selectedLens === 'bd' && (
                <button
                  role="tab"
                  aria-selected={searchMode === 'name'}
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
                  <div className="flex items-center" aria-hidden="true">
                    <Building2 className={`w-4 h-4 mr-1 ${searchMode === 'name' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'name' ? 2 : 1.5} />
                    <span className={`text-xs ${searchMode === 'name' ? 'text-[#E07A5F]' : 'text-gray-400'}`}>/</span>
                    <User className={`w-4 h-4 ml-0.5 ${searchMode === 'name' ? 'text-[#E07A5F]' : ''}`} strokeWidth={searchMode === 'name' ? 2 : 1.5} />
                  </div>
                  <span className={searchMode === 'name' ? 'font-medium' : ''}>{MODE_LABELS.name}</span>
                </button>
              )}
            </div>
          </div>

          {/* Dynamic help box — explains the current lens × mode
              combination. Replaces the previous static example tiles,
              which taught WHAT a query might look like but not WHEN to
              pick which combination. The box updates immediately as
              the user toggles persona or mode above.
              Example is clickable: tapping it drops the text into the
              search input so the user can tweak and submit. */}
          {currentHelp && (() => {
            const currentLens = LENS_CONFIG.find(l => l.id === selectedLens)
            const LensIcon = currentLens?.icon ?? FlaskConical
            const ModeIcon = MODE_ICONS[searchMode]
            return (
              <div className="p-4 bg-[#FDF2EF] rounded-xl text-left">
                {/* Box title — identifies the panel as search guidance
                    before the user parses the pills + prose. Keeps the
                    small uppercase tracking style used by other section
                    labels in the component. */}
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#C96A4F] uppercase tracking-wider mb-3">
                  <Lightbulb className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                  <span>Search Hints</span>
                </div>
                {/* Header pills — mirror the lens and mode pill the user
                    just clicked above, with a visual "+" between them.
                    Reinforces the mental model that the box is about the
                    combination of those two choices. */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full shadow-sm">
                    <LensIcon className="w-3.5 h-3.5 text-[#E07A5F]" strokeWidth={2} aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-900">{currentLens?.label}</span>
                  </div>
                  <span className="text-[#E07A5F] text-sm font-medium" aria-hidden="true">+</span>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full shadow-sm">
                    <ModeIcon className="w-3.5 h-3.5 text-[#E07A5F]" strokeWidth={2} aria-hidden="true" />
                    <span className="text-xs font-medium text-gray-900">{MODE_LABELS[searchMode]}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  {currentHelp.what}
                </p>
                <p className="text-sm text-gray-500 leading-relaxed mb-4">
                  {currentHelp.when}
                </p>
                <div className="pt-3 border-t border-[#E07A5F]/15">
                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
                    Example
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput(currentHelp.example)
                      inputRef.current?.focus()
                    }}
                    className="text-sm text-gray-700 hover:text-[#C96A4F] transition-colors underline-offset-4 hover:underline text-left"
                  >
                    {currentHelp.example}
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
