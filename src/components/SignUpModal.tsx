// SignUpModal — wraps the shared AuthForm in a modal shell so deep-page
// CTAs can present sign-in without the page-scroll redirection. Used
// by /, /reports, and /pricing for any "Get Started Free" / "Browse
// the data" / "Buy a Report" CTA that sits below the fold.
//
// Why a modal here rather than a scroll-to-form anchor: scrolling
// works fine for the in-hero CTA (form is visible alongside the
// button), but for CTAs deep in the page a scroll-to-top is
// disorienting on mobile and ambiguous on desktop — the visitor sees
// the page move and has to mentally connect that to their click. The
// modal makes the cause-and-effect direct and lets the visitor cancel
// without losing their place.
//
// The shared AuthForm component does the actual auth work; this is
// just the chrome.

'use client'

import { Suspense } from 'react'
import { X } from 'lucide-react'
import { AuthForm, AuthFormFallback } from './AuthForm'

interface SignUpModalProps {
  open: boolean
  onClose: () => void
  /** Where to send the visitor after auth completes (default /chat). */
  redirect?: string
  /** Title shown above the form. Defaults to a generic welcome. */
  title?: string
  /** Subtitle / framing line. Defaults to the free-account positioning. */
  description?: string
}

export function SignUpModal({
  open,
  onClose,
  redirect,
  title = 'Create a free account',
  description = 'Search every project, trial, patent, and publication in our database — verify your topic has signal before you buy a report.',
}: SignUpModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div className="pr-6">
            <h2
              id="signup-modal-title"
              className="text-lg font-semibold text-gray-900"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">
              {description}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <Suspense fallback={<AuthFormFallback />}>
            <AuthForm redirect={redirect} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
