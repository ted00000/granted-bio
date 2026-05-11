import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { AdminSignOut } from './AdminSignOut'
import { Logo } from '@/components/Logo'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/admin')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Admin Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <Link href="/" aria-label="granted.bio home" className="inline-flex items-center hover:opacity-80 transition-opacity">
                <Logo height={28} />
              </Link>
              <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
                Admin
              </span>
            </div>
            <nav className="flex items-center space-x-6">
              <Link
                href="/admin"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Dashboard
              </Link>
              <Link
                href="/admin/upload"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Upload Data
              </Link>
              <Link
                href="/admin/jobs"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Jobs
              </Link>
              <Link
                href="/admin/users"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Users
              </Link>
              <Link
                href="/admin/categorization-review"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Review
              </Link>
              <Link
                href="/admin/beta-users"
                className="text-sm font-medium text-gray-700 hover:text-blue-600"
              >
                Beta
              </Link>
              <span className="text-sm text-gray-500">{user.email}</span>
              <AdminSignOut />
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
