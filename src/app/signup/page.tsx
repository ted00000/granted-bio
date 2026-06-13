'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Redirect old signup page to homepage which now hosts the auth form.
//
// Preserves query params (notably `redirect`) so a CTA like
// /signup?redirect=/reports correctly returns the user to /reports
// after they finish signing in. Without preservation, every signup
// flow defaults to /chat regardless of where the user was trying to
// go — that's a real conversion leak when the intent was clear.

function SignupRedirect() {
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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center">
          <p className="text-gray-500">Redirecting...</p>
        </div>
      }
    >
      <SignupRedirect />
    </Suspense>
  )
}
