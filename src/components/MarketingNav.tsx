import Link from 'next/link'

interface MarketingNavProps {
  showSignIn?: boolean
}

export function MarketingNav({ showSignIn = false }: MarketingNavProps) {
  return (
    <header className="border-b border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-2xl font-semibold tracking-tight text-gray-900">
          granted<span className="text-[#E07A5F]">.bio</span>
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <Link
            href="/reports"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            Reports
          </Link>
          <Link
            href="/pricing"
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            Pricing
          </Link>
          {showSignIn && (
            <Link
              href="/"
              className="text-white bg-[#E07A5F] px-4 py-2 rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
