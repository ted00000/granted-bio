import Link from 'next/link'
import { FileText, ArrowRight } from 'lucide-react'
import { Logo } from '@/components/Logo'

interface MarketingNavProps {
  /**
   * Show the Sign In button on the right. Off by default (the home page
   * carries the auth form inline, so the Sign In button is redundant
   * there). Pass true on marketing pages that aren't the home page.
   */
  showSignIn?: boolean
}

export function MarketingNav({ showSignIn = false }: MarketingNavProps) {
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
          <Link
            href="/reports"
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <FileText className="w-4 h-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Reports</span>
          </Link>
          <Link
            href="/pricing"
            className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Pricing
          </Link>

          {showSignIn ? (
            <>
              <Link
                href="/login"
                className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="ml-1 inline-flex items-center gap-1 text-white bg-[#E07A5F] px-4 py-2 rounded-lg hover:bg-[#C96A4F] transition-colors"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
