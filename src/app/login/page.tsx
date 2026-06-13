'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Redirect old login page to homepage which now hosts the auth form.
// Preserves query params so /login?redirect=/foo returns the user to
// /foo after they finish signing in. See /signup for the same pattern
// and rationale.

function LoginRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = searchParams.toString()
    router.replace(params ? `/?${params}` : '/')
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-500">Redirecting...</p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <p className="text-gray-500">Redirecting...</p>
        </div>
      }
    >
      <LoginRedirect />
    </Suspense>
  )
}
