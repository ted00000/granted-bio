'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Search, TrendingUp, Users, Activity, Menu, X, LogOut, Home } from 'lucide-react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'
import type { PersonaType } from '@/lib/chat/types'

interface SidebarProps {
  currentPersona?: PersonaType | null
  onPersonaChange?: (persona: PersonaType) => void
  userName?: string | null
}

const NAV_ITEMS: Array<{
  id: PersonaType
  label: string
  subtitle: string
  icon: typeof Search
}> = [
  { id: 'researcher', label: 'Research', subtitle: 'Topic deep dives', icon: Search },
  { id: 'bd', label: 'Leads', subtitle: 'Find contacts', icon: Users },
  { id: 'investor', label: 'Market', subtitle: 'Market sizing', icon: TrendingUp },
  { id: 'trials', label: 'Trials', subtitle: 'Clinical pipelines', icon: Activity },
]

export function Sidebar({ currentPersona, onPersonaChange, userName }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createBrowserSupabaseClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleNavClick = (persona: PersonaType) => {
    if (onPersonaChange) {
      onPersonaChange(persona)
    } else {
      router.push(`/chat?persona=${persona}`)
    }
    setIsOpen(false)
  }

  const handleHomeClick = () => {
    router.push('/chat')
    setIsOpen(false)
  }

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white shadow-md border border-gray-100"
      >
        {isOpen ? (
          <X className="w-5 h-5 text-gray-600" />
        ) : (
          <Menu className="w-5 h-5 text-gray-600" />
        )}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 bg-white border-r border-gray-100
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex-shrink-0 px-5 py-6 text-center">
          <button
            onClick={handleHomeClick}
            className="text-xl font-semibold tracking-tight text-gray-900 hover:opacity-80 transition-opacity"
          >
            granted<span className="text-[#E07A5F]">.bio</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const isActive = currentPersona === item.id
            const Icon = item.icon

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                  transition-all duration-150
                  ${isActive
                    ? 'bg-gray-50 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
              >
                <Icon
                  className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-[#E07A5F]' : 'text-gray-400'}`}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${isActive ? 'text-gray-900' : ''}`}>
                    {item.label}
                  </div>
                  <div className="text-xs text-gray-400 truncate">
                    {item.subtitle}
                  </div>
                </div>
              </button>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div className="flex-shrink-0 border-t border-gray-100 p-3 space-y-1">
          {userName && (
            <div className="px-3 py-2 text-sm text-gray-500 truncate">
              {userName}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all"
          >
            <LogOut className="w-5 h-5 text-gray-400" strokeWidth={1.5} />
            <span className="text-sm">Sign out</span>
          </button>
          <div className="flex items-center justify-center gap-4 pt-2 text-xs text-gray-400">
            <Link href="/privacy" className="hover:text-gray-600">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-600">Terms</Link>
          </div>
        </div>
      </aside>
    </>
  )
}
