// Auth-aware "Generate a Report" CTA. Used on intent-driven surfaces
// like /sample and /pricing where the visitor has already seen the
// value pitch and the next meaningful step is either:
//
// - Logged in: jump straight to /reports dashboard so they can name
//   a topic and pay.
// - Logged out: open the sign-in modal here, skipping the /reports
//   marketing landing (which is a duplicate pitch for someone who
//   just clicked a deliberate CTA).
//
// The caller styles the button via className + children so each
// surface can keep its existing visual language; this component only
// owns the behavior.

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { SignUpModal } from '@/components/SignUpModal'

interface GenerateReportCTAProps {
  /** Where to land the visitor after they sign in (or right away if
   *  already signed in). Defaults to /reports. */
  redirectTo?: string
  /** Modal title for the logged-out path. */
  modalTitle?: string
  /** Modal description for the logged-out path. */
  modalDescription?: string
  className?: string
  children: React.ReactNode
}

export function GenerateReportCTA({
  redirectTo = '/reports',
  modalTitle = 'Create a free account to generate',
  modalDescription = 'A free account is required so the report ties to your login and you can drill into every linked record during the 3-month window. Signing up takes a few seconds.',
  className,
  children,
}: GenerateReportCTAProps) {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const [signUpOpen, setSignUpOpen] = useState(false)

  const onClick = () => {
    if (isLoading) return
    if (user) {
      router.push(redirectTo)
    } else {
      setSignUpOpen(true)
    }
  }

  return (
    <>
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
      <SignUpModal
        open={signUpOpen}
        onClose={() => setSignUpOpen(false)}
        redirect={redirectTo}
        title={modalTitle}
        description={modalDescription}
      />
    </>
  )
}
