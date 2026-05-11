'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Search, Activity, Menu, X, LogOut, FlaskConical, FileText, Users, Settings, Shield } from 'lucide-react'
import { PremiumBadge } from '@/components/ui/PremiumBadge'
import { useAuth } from '@/contexts/AuthContext'
import type { PersonaType } from '@/lib/chat/types'

interface SidebarProps {
  currentPersona?: PersonaType | null
  onPersonaChange?: (persona: PersonaType) => void
  userName?: string | null
}

export function Sidebar({ currentPersona, onPersonaChange, userName }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const { isAdmin, usage, signOut, profile } = useAuth()

  const handleSignOut = async () => {
    await signOut()
    router.refresh()
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
        aria-expanded={isOpen}
        aria-controls="main-sidebar"
        aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
        className="lg:hidden fixed top-[max(1rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] z-50 p-2 rounded-lg bg-white shadow-md border border-gray-100"
      >
        {isOpen ? (
          <X className="w-5 h-5 text-gray-600" aria-hidden="true" />
        ) : (
          <Menu className="w-5 h-5 text-gray-600" aria-hidden="true" />
        )}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/20 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="main-sidebar"
        role="navigation"
        aria-label="Main navigation"
        className={`
          fixed lg:static inset-y-0 left-0 z-40
          w-64 bg-white border-r border-gray-100
          flex flex-col
          transform transition-transform duration-200 ease-in-out
          pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="flex-shrink-0 px-5 pt-6 pb-6 text-center">
          <button
            onClick={handleHomeClick}
            className="text-xl font-semibold tracking-tight text-gray-900 hover:opacity-80 transition-opacity"
          >
            granted<span className="text-[#E07A5F]">.bio</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 px-3 py-2 overflow-y-auto overscroll-y-contain">
          {/* Search */}
          <button
            onClick={handleHomeClick}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left mb-1
              transition-all duration-150
              ${pathname === '/chat' || pathname?.startsWith('/chat')
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Search
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/chat' || pathname?.startsWith('/chat') ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/chat' || pathname?.startsWith('/chat') ? 2 : 1.5}
            />
            <span className={`text-sm font-medium ${pathname === '/chat' || pathname?.startsWith('/chat') ? 'text-gray-900' : ''}`}>
              Search
            </span>
          </button>

          {/* Reports */}
          <Link
            href="/reports"
            onClick={() => setIsOpen(false)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left mb-1
              transition-all duration-150
              ${pathname === '/reports' || pathname.startsWith('/reports/')
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <FileText
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/reports' || pathname.startsWith('/reports/') ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/reports' || pathname.startsWith('/reports/') ? 2 : 1.5}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${pathname === '/reports' || pathname.startsWith('/reports/') ? 'text-gray-900' : ''}`}>
                  Reports
                </span>
                {/* Premium badge is a paywall hint — only show to free users.
                    Beta, pro, admin, associate already have access. */}
                {profile?.tier === 'free' && <PremiumBadge size="sm" />}
              </div>
            </div>
          </Link>

          {/* Divider */}
          <div className="py-2">
            <div className="border-t border-gray-100" />
          </div>

          {/* My Projects Link */}
          <Link
            href="/projects"
            onClick={() => setIsOpen(false)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
              transition-all duration-150
              ${pathname === '/projects'
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <FlaskConical
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/projects' ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/projects' ? 2 : 1.5}
            />
            <div className="min-w-0">
              <div className={`text-sm font-medium ${pathname === '/projects' ? 'text-gray-900' : ''}`}>
                My Projects
              </div>
              <div className="text-xs text-gray-400 truncate">
                Saved projects
              </div>
            </div>
          </Link>

          {/* My People Link */}
          <Link
            href="/people"
            onClick={() => setIsOpen(false)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
              transition-all duration-150
              ${pathname === '/people'
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Users
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/people' ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/people' ? 2 : 1.5}
            />
            <div className="min-w-0">
              <div className={`text-sm font-medium ${pathname === '/people' ? 'text-gray-900' : ''}`}>
                My People
              </div>
              <div className="text-xs text-gray-400 truncate">
                Saved researchers
              </div>
            </div>
          </Link>

          {/* My Trials Link */}
          <Link
            href="/trials"
            onClick={() => setIsOpen(false)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
              transition-all duration-150
              ${pathname === '/trials'
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Activity
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/trials' ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/trials' ? 2 : 1.5}
            />
            <div className="min-w-0">
              <div className={`text-sm font-medium ${pathname === '/trials' ? 'text-gray-900' : ''}`}>
                My Trials
              </div>
              <div className="text-xs text-gray-400 truncate">
                Saved trials
              </div>
            </div>
          </Link>
        </nav>

        {/* Bottom section */}
        <div className="flex-shrink-0 border-t border-gray-100 p-3 space-y-1">
          {userName && (
            <div className="px-3 py-2 text-sm text-gray-500 truncate flex items-center gap-2">
              <span className="truncate">{userName}</span>
              {profile?.tier === 'beta' && (
                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-violet-100 text-violet-700 rounded">
                  Beta
                </span>
              )}
            </div>
          )}
          {/* Beta report count + days remaining */}
          {profile?.tier === 'beta' && profile.betaExpiresAt && (() => {
            const daysLeft = Math.max(0, Math.ceil(
              (new Date(profile.betaExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            ))
            const reportsLeft = Math.max(0, 3 - (profile.reportsGenerated ?? 0))
            return (
              <Link
                href="/account"
                className="px-3 py-1.5 text-xs rounded flex items-center justify-between bg-violet-50 text-violet-700"
              >
                <span>Reports</span>
                <span className="font-medium">{reportsLeft} left · {daysLeft}d</span>
              </Link>
            )
          })()}
          {/* Usage indicator - show for free users always, pro users only when approaching limit, never for unlimited */}
          {usage && !usage.isUnlimited && (profile?.tier === 'free' || usage.searchesUsed >= usage.searchLimit * 0.8) && (
            <Link
              href="/account"
              className={`
                px-3 py-1.5 text-xs rounded flex items-center justify-between
                ${usage.searchesUsed >= usage.searchLimit * 0.9
                  ? 'bg-rose-50 text-rose-600'
                  : usage.searchesUsed >= usage.searchLimit * 0.7
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-gray-50 text-gray-500'
                }
              `}
            >
              <span>Searches</span>
              <span className="font-medium">{usage.searchesUsed}/{usage.searchLimit}</span>
            </Link>
          )}
          <Link
            href="/account"
            onClick={() => setIsOpen(false)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
              transition-all duration-150
              ${pathname === '/account'
                ? 'bg-gray-50 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }
            `}
          >
            <Settings
              className={`w-5 h-5 flex-shrink-0 ${pathname === '/account' ? 'text-[#E07A5F]' : 'text-gray-400'}`}
              strokeWidth={pathname === '/account' ? 2 : 1.5}
            />
            <span className={`text-sm ${pathname === '/account' ? 'font-medium' : ''}`}>Account</span>
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setIsOpen(false)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                transition-all duration-150
                ${pathname?.startsWith('/admin')
                  ? 'bg-gray-50 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }
              `}
            >
              <Shield
                className={`w-5 h-5 flex-shrink-0 ${pathname?.startsWith('/admin') ? 'text-[#E07A5F]' : 'text-gray-400'}`}
                strokeWidth={pathname?.startsWith('/admin') ? 2 : 1.5}
              />
              <span className={`text-sm ${pathname?.startsWith('/admin') ? 'font-medium' : ''}`}>Admin</span>
            </Link>
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
