import Link from 'next/link'
import { Search, FileText, User } from 'lucide-react'
import { Logo } from '@/components/Logo'

interface MarketingNavProps {
  showSignIn?: boolean
}

export function MarketingNav({ showSignIn = false }: MarketingNavProps) {
  return (
    <header className="border-b border-gray-100 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" aria-label="granted.bio home" className="flex items-center hover:opacity-80 transition-opacity">
          <Logo height={40} priority />
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link
            href="/chat"
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <Search className="w-4 h-4" strokeWidth={1.5} />
            Search
          </Link>
          <Link
            href="/reports"
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <FileText className="w-4 h-4" strokeWidth={1.5} />
            Reports
          </Link>
          <Link
            href="/account"
            className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <User className="w-4 h-4" strokeWidth={1.5} />
            Account
          </Link>
          {showSignIn && (
            <Link
              href="/"
              className="ml-2 text-white bg-[#E07A5F] px-4 py-2 rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
