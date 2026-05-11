'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { IntentType, PersonaType } from '@/lib/chat/types'
import { INTENT_TO_PERSONA } from '@/lib/chat/types'
import { Logo } from '@/components/Logo'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Search, Users, Activity, FileText } from 'lucide-react'
import { PremiumBadge } from '@/components/ui/PremiumBadge'

interface PersonaSelectorProps {
  onSelect: (persona: PersonaType) => void
}

// Greetings with {name} placeholder
const GREETINGS = [
  "Good to see you, {name}",
  "Welcome back, {name}",
  "Hey {name}, ready to explore?",
  "Hi {name}, what can I help you find?",
  "Hello {name}, let's discover something",
  "{name}, good to have you here",
  "What's on your mind today, {name}?",
  "Ready when you are, {name}",
  "{name}, where shall we start?",
  "Nice to see you again, {name}",
  "Hey there, {name}",
  "What are we researching today, {name}?",
  "{name}, let's find some insights",
  "Welcome, {name}. What's the mission?",
  "Hi {name}, what's the focus today?",
  "{name}, ready to dive in?",
  "Good day, {name}",
  "Let's get to work, {name}",
  "What can I find for you, {name}?",
  "{name}, what shall we explore?",
]

// Time-based greetings
const getTimeGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function getGreeting(name: string | null): string {
  if (!name) {
    return "What are you looking for?"
  }

  const firstName = name.split(' ')[0]

  // Use date as seed for consistent daily greeting
  const today = new Date()
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate()
  const index = seed % GREETINGS.length

  // 20% chance to use time-based greeting instead
  if (seed % 5 === 0) {
    return `${getTimeGreeting()}, ${firstName}`
  }

  return GREETINGS[index].replace('{name}', firstName)
}

const searchIntents: {
  id: IntentType
  label: string
  title: string
  question: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    id: 'research',
    label: 'What',
    title: 'Research',
    question: 'What science is being funded?',
    description: 'Topic deep dives, funded projects, publications',
    icon: <Search className="w-5 h-5" strokeWidth={1.5} />,
  },
  {
    id: 'trials',
    label: 'How',
    title: 'Trials',
    question: 'How is it being applied?',
    description: 'Clinical pipelines, phases, trial tracking',
    icon: <Activity className="w-5 h-5" strokeWidth={1.5} />,
  },
  {
    id: 'leads',
    label: 'Who',
    title: 'People',
    question: 'Who is working on this?',
    description: 'Find researchers, PIs, institutions',
    icon: <Users className="w-5 h-5" strokeWidth={1.5} />,
  },
]

export function PersonaSelector({ onSelect }: PersonaSelectorProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [needsName, setNeedsName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])

  // Fetch user's first name on mount
  useEffect(() => {
    let isMounted = true

    const fetchProfile = async (id: string) => {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('first_name')
          .eq('id', id)
          .single()

        if (!isMounted) return

        if (profileError) {
          console.error('Profile fetch error:', profileError)
          setNeedsName(true)
        } else if (profile?.first_name) {
          setFirstName(profile.first_name)
        } else {
          setNeedsName(true)
        }
      } catch (err) {
        console.error('Profile fetch failed:', err)
        if (isMounted) {
          setNeedsName(true)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    // Check session immediately on mount
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!isMounted) return

      if (session?.user) {
        setUserId(session.user.id)
        await fetchProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    }

    checkSession()

    // Also listen for auth changes (sign out, etc)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        if (!isMounted) return

        if (event === 'SIGNED_OUT') {
          setFirstName(null)
          setUserId(null)
          setNeedsName(false)
          setIsLoading(false)
        }
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameInput.trim() || !userId) return

    setSaving(true)
    const trimmedName = nameInput.trim()

    await supabase
      .from('user_profiles')
      .update({ first_name: trimmedName })
      .eq('id', userId)

    setFirstName(trimmedName)
    setNeedsName(false)
    setSaving(false)
  }

  const greeting = useMemo(() => getGreeting(firstName), [firstName])

  const handleSelect = (intent: IntentType) => {
    const persona = INTENT_TO_PERSONA[intent]
    onSelect(persona)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="px-6 py-4">
        <nav className="max-w-5xl mx-auto flex items-center justify-between">
          <Logo height={40} />
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-3xl mx-auto w-full">
          {isLoading ? (
            <div className="flex justify-center">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            </div>
          ) : needsName ? (
            <div className="max-w-sm mx-auto text-center">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 mb-8">
                What name should we use?
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
                  disabled={saving || !nameInput.trim()}
                  className="w-full py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Continue'}
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="text-center mb-10">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 mb-3">
                  {greeting}
                </h1>
                <p className="text-lg text-gray-500">
                  Choose your focus to get started
                </p>
              </div>

              {/* Search Modes */}
              <div className="mb-8">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Search</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {searchIntents.map(intent => (
                    <button
                      key={intent.id}
                      onClick={() => handleSelect(intent.id)}
                      className="group p-5 bg-white rounded-xl border border-gray-100 hover:border-[#E07A5F] hover:shadow-md transition-all text-left"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div className="text-gray-400 group-hover:text-[#E07A5F] transition-colors">
                          {intent.icon}
                        </div>
                        <span className="text-xs font-medium text-gray-400 uppercase">{intent.label}</span>
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

              {/* Intelligence Reports - Premium */}
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-4">Analyze</p>
                <button
                  onClick={() => handleSelect('market')}
                  className="group w-full p-5 bg-gradient-to-r from-gray-50 to-white rounded-xl border border-gray-200 hover:border-[#E07A5F] hover:shadow-md transition-all text-left"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-gray-400 group-hover:text-[#E07A5F] transition-colors">
                      <FileText className="w-5 h-5" strokeWidth={1.5} />
                    </div>
                    <PremiumBadge />
                  </div>
                  <h2 className="text-base font-medium text-gray-900 mb-1">
                    Intelligence Reports
                  </h2>
                  <p className="text-sm text-[#E07A5F] mb-2">
                    &ldquo;Generate a landscape analysis&rdquo;
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Synthesize funding, patents, trials, and publications into comprehensive reports
                  </p>
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-gray-100">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data from NIH RePORTER, ClinicalTrials.gov, USPTO & PubMed
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
