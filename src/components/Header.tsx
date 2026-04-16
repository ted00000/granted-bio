'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export function Header() {
  const { user, isAdmin, signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  return (
    <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-blue-600">
            granted.bio
          </Link>
          <nav className="flex items-center space-x-4">
            <Link
              href="/chat"
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              AI Search
            </Link>
            {user ? (
              <>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
                  >
                    Admin
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  )
}
