'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { IntentType, PersonaType } from '@/lib/chat/types'
import { INTENT_TO_PERSONA } from '@/lib/chat/types'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import { Search, TrendingUp, Users, Activity } from 'lucide-react'

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
  const router = useRouter()
  const [userName, setUserName] = useState<string | null>(null)
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])

  // Fetch user's name on mount
  useEffect(() => {
    const fetchUserName = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Try to get name from profile first
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('full_name')
          .eq('id', user.id)
          .single()

        if (profile?.full_name) {
          setUserName(profile.full_name)
        } else if (user.user_metadata?.full_name) {
          // Fall back to auth metadata (from Google)
          setUserName(user.user_metadata.full_name)
        } else if (user.user_metadata?.name) {
          setUserName(user.user_metadata.name)
        }
      }
    }
    fetchUserName()
  }, [supabase])

  const greeting = useMemo(() => getGreeting(userName), [userName])

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
          <span className="text-2xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </span>
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
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 mb-3">
              {greeting}
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
            Data sourced from NIH RePORTER (2024–2025)
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
