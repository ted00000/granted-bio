'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, ArrowRight, Menu, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { SignUpModal } from '@/components/SignUpModal'
import { useOptionalAuth } from '@/contexts/AuthContext'

// Match a nav link against the current pathname. Uses startsWith so
// nested sample/report routes (e.g. /sample/liquid-biopsy → /sample,
// /reports/[id] → /reports) still light up their parent nav item.
function isActive(pathname: string, href: string): boolean {
  if (href === '/sample/liquid-biopsy') return pathname.startsWith('/sample')
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function MarketingNav() {
  const pathname = usePathname()
  const [signInOpen, setSignInOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // useOptionalAuth so MarketingNav can render outside the
  // AuthProvider tree without throwing (e.g., if it's ever embedded
  // in a server-rendered shell). isLoading covers the brief window
  // before AuthContext resolves on a fresh page load — during it we
  // keep showing the logged-out CTAs to avoid a flash of the
  // logged-in nav for visitors who aren't actually authed.
  const auth = useOptionalAuth()
  // Require BOTH user and profile to consider the visitor logged in.
  // A ghost session (valid JWT but the user_profiles row was cascade-
  // deleted in the dashboard) would otherwise show the "Open dashboard"
  // CTA even though the dashboard would 401 on the next request.
  // AuthContext's ghost-cleanup catches up on its own; this check is
  // the belt-and-suspenders for the brief window before it does.
  const isLoggedIn = !!auth?.user && !!auth?.profile && !auth.isLoading

  const baseLink =
    'px-3 py-2 rounded-lg transition-colors hover:bg-gray-50'
  const inactive = 'text-gray-600 hover:text-gray-900'
  const active = 'text-[#E07A5F] hover:text-[#C96A4F]'

  const linkClass = (href: string, extra = '') =>
    `${baseLink} ${isActive(pathname, href) ? active : inactive} ${extra}`.trim()

  // Full-width row in the mobile drop panel — larger tap target than
  // the desktop link style and aligns left for scan-ability.
  const mobileLinkBase =
    'block w-full px-3 py-3 rounded-lg transition-colors hover:bg-gray-50 text-base'
  const mobileLinkClass = (href: string, extra = '') =>
    `${mobileLinkBase} ${isActive(pathname, href) ? active : inactive} ${extra}`.trim()

  const closeMenu = () => setMenuOpen(false)
  const openSignIn = () => {
    setMenuOpen(false)
    setSignInOpen(true)
  }

  return (
    <header className="border-b border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link
          href="/"
          aria-label="granted.bio home"
          className="flex items-center flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          <Logo className="h-9 sm:h-10" />
        </Link>

        {/* Desktop nav — visible from sm up */}
        <div className="hidden sm:flex items-center gap-1 text-sm">
          <Link href="/" className={linkClass('/')}>
            Home
          </Link>
          <Link
            href="/sample/liquid-biopsy"
            className={linkClass('/sample/liquid-biopsy')}
          >
            Sample
          </Link>
          <Link
            href="/reports"
            className={linkClass('/reports', 'flex items-center gap-2')}
          >
            <FileText className="w-4 h-4" strokeWidth={1.5} />
            <span>Reports</span>
          </Link>
          <Link href="/pricing" className={linkClass('/pricing')}>
            Pricing
          </Link>

          {isLoggedIn ? (
            <Link
              href="/reports"
              className="ml-1 inline-flex items-center gap-1 text-white bg-[#E07A5F] px-4 py-2 rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Open dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className={linkClass('/login')}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="ml-1 inline-flex items-center gap-1 text-white bg-[#E07A5F] px-4 py-2 rounded-lg hover:bg-[#C96A4F] transition-colors"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="sm:hidden p-2 -mr-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile drop panel — rendered only when open. Stacked links with
          larger tap targets; closing on tap so navigation feels
          immediate. */}
      {menuOpen && (
        <div id="mobile-nav" className="sm:hidden border-t border-gray-100 bg-white">
          <nav className="max-w-6xl mx-auto px-6 py-3 flex flex-col gap-1">
            <Link href="/" onClick={closeMenu} className={mobileLinkClass('/')}>
              Home
            </Link>
            <Link
              href="/sample/liquid-biopsy"
              onClick={closeMenu}
              className={mobileLinkClass('/sample/liquid-biopsy')}
            >
              Sample
            </Link>
            <Link
              href="/reports"
              onClick={closeMenu}
              className={mobileLinkClass('/reports', 'flex items-center gap-2')}
            >
              <FileText className="w-4 h-4" strokeWidth={1.5} />
              <span>Reports</span>
            </Link>
            <Link
              href="/pricing"
              onClick={closeMenu}
              className={mobileLinkClass('/pricing')}
            >
              Pricing
            </Link>

            <div className="border-t border-gray-100 my-2" />

            {isLoggedIn ? (
              <Link
                href="/reports"
                onClick={closeMenu}
                className="inline-flex items-center justify-center gap-1 text-white bg-[#E07A5F] px-4 py-3 rounded-lg hover:bg-[#C96A4F] transition-colors text-base font-medium"
              >
                Open dashboard
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openSignIn}
                  className={mobileLinkClass('/login', 'text-left')}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={openSignIn}
                  className="inline-flex items-center justify-center gap-1 text-white bg-[#E07A5F] px-4 py-3 rounded-lg hover:bg-[#C96A4F] transition-colors text-base font-medium mt-1"
                >
                  Get Started Free
                  <ArrowRight className="w-4 h-4" />
                </button>
              </>
            )}
          </nav>
        </div>
      )}

      <SignUpModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        title="Sign in to granted.bio"
        description="Returning? Use the same email or Google account you signed up with. New here? Either option creates an account on the spot."
      />
    </header>
  )
}
