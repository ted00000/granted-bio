'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Redirect old signup page to homepage which now has auth
export default function SignupPage() {
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
