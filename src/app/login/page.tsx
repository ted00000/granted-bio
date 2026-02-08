'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Redirect old login page to homepage which now has auth
export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/')
  }, [router])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-500">Redirecting...</p>
    </div>
  )
}
