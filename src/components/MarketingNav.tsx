'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, ArrowRight } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { SignUpModal } from '@/components/SignUpModal'

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

  const baseLink =
    'px-3 py-2 rounded-lg transition-colors hover:bg-gray-50'
  const inactive = 'text-gray-600 hover:text-gray-900'
  const active = 'text-[#E07A5F] hover:text-[#C96A4F]'

  const linkClass = (href: string, extra = '') =>
    `${baseLink} ${isActive(pathname, href) ? active : inactive} ${extra}`.trim()

  return (
    <header className="border-b border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        {/* Logo: flex-shrink-0 prevents squeezing on narrow viewports.
            Smaller on mobile (h-7) than desktop (h-10) so it doesn't
            crowd the nav links. */}
        <Link
          href="/"
          aria-label="granted.bio home"
          className="flex items-center flex-shrink-0 hover:opacity-80 transition-opacity"
        >
          <Logo className="h-7 sm:h-10" />
        </Link>

        <div className="flex items-center gap-1 text-sm">
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
            className={linkClass('/sample/liquid-biopsy', 'hidden sm:inline-block')}
          >
            Sample
          </Link>
          <Link
            href="/reports"
            className={linkClass('/reports', 'flex items-center gap-2')}
          >
            <FileText className="w-4 h-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Reports</span>
          </Link>
          <Link href="/pricing" className={linkClass('/pricing')}>
            Pricing
          </Link>

          {/* Sign In and Get Started Free both open the same modal —
              the underlying AuthForm handles new sign-ups and returning
              sign-ins identically (Google or magic link), so a single
              auth surface serves both intents. Keeping both labels in
              the nav preserves the recognizable affordances; the modal
              copy addresses both audiences explicitly. */}
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
