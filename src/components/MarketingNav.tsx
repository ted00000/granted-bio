'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, ArrowRight } from 'lucide-react'
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

  return (
    <header className="border-b border-gray-100 bg-white">
      {/* Layout: stacked on mobile (logo on its own row above, nav below)
          so the logo gets visual presence and the nav links get full
          width for legibility / tap targets. Side-by-side on sm+ where
          there's room. */}
      <div className="max-w-6xl mx-auto px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-center sm:justify-between gap-3 sm:gap-4">
        <Link
          href="/"
          aria-label="granted.bio home"
          className="flex items-center flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          {/* Bigger logo on mobile now that it's on its own row;
              desktop stays at h-10. */}
          <Logo className="h-9 sm:h-10" />
        </Link>

        <div className="flex items-center gap-1 text-sm flex-wrap justify-center sm:justify-end">
          {/* Home points at / where the inline sign-in form lives. The
              logo also routes here, but a labeled Home link gives
              visitors who don't realize the logo is clickable an
              explicit way back, and gives anyone with an existing
              account a clear path to the sign-in form. */}
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

          {/* Auth CTAs adapt to the visitor's state:
              - Logged out: Sign In + Get Started Free, both opening
                the same modal. The modal copy addresses both
                returning and new visitors. Sign In is hidden on mobile
                since it's redundant with Get Started Free (both open
                the same modal) and would crowd the wrapped row.
              - Logged in: a single "Open dashboard" link to /reports
                so a returning authed user has an obvious next step
                and isn't confronted with sign-in CTAs that would do
                nothing meaningful for them. */}
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
                className={`${linkClass('/login')} hidden sm:inline-block`}
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
      </div>

      <SignUpModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        title="Sign in to granted.bio"
        description="Returning? Use the same email or Google account you signed up with. New here? Either option creates an account on the spot."
      />
    </header>
  )
}
