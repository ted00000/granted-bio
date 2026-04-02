'use client'

import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

export function AdminSignOut() {
  const router = useRouter()
  const supabase = createBrowserSupabaseClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.refresh()
    router.push('/')
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm font-medium text-gray-500 hover:text-red-600"
    >
      Sign out
    </button>
  )
}
