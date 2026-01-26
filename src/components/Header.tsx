import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function Header() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  let isAdmin = false
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    isAdmin = profile?.role === 'admin'
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
              href="/search"
              className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
            >
              Search
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
                <form action="/api/auth/signout" method="POST">
                  <button
                    type="submit"
                    className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-blue-600"
                  >
                    Sign out
                  </button>
                </form>
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
