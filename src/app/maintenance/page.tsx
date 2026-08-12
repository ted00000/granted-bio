// Maintenance landing. Middleware redirects every user-facing page
// here when MAINTENANCE_MODE=true is set in Vercel. Deliberately
// contains NO product CTAs (would create dead-end loops back into
// pages that redirect right back here) and NO auth chrome (no sign-in
// form, no dashboard link).
//
// Kept minimal — logo, headline, one paragraph, contact address,
// small legal links. Renders standalone (no MarketingNav) so a
// visitor who arrives here isn't tempted to try navigating.

import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { Wrench } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'System Undergoing Improvement Updates | granted.bio',
  description:
    'granted.bio is temporarily unavailable while we ship improvements. We will be back shortly. Contact hello@granted.bio for anything urgent.',
}

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-[#FAFAF9] flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-lg w-full text-center">
          <div className="mb-8 flex justify-center">
            <Logo className="h-12" priority />
          </div>

          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#FDF2EF] mb-6">
            <Wrench className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
          </div>

          <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-3">
            System Undergoing Improvement Updates
          </h1>

          <p className="text-gray-600 leading-relaxed mb-6">
            granted.bio is temporarily paused while we ship a set of
            improvements to how analyses are presented. Your existing
            analyses and account data are safe and will be available
            when we are back.
          </p>

          <p className="text-sm text-gray-500 mb-8">
            Questions or something urgent?{' '}
            <a
              href="mailto:hello@granted.bio"
              className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              hello@granted.bio
            </a>
          </p>

          <div className="flex items-center justify-center gap-4 text-xs text-gray-400">
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
