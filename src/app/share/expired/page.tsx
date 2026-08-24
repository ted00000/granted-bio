// Terminal page for invalid / revoked / expired share links.
//
// Middleware redirects any /share/[token] request here when the token
// doesn't resolve to an active share. We deliberately don't
// distinguish the three cases in the copy — the recipient can't do
// anything different with that information, and telling them "this
// link was revoked" invites awkward outreach to the sender. "The
// sender can send a new link" is the same next step in all cases.
//
// Also serves as a soft conversion surface: someone landed here
// because a person they know shared granted.bio with them, so pitch
// gently and give them a way in.

import Link from 'next/link'
import { Logo } from '@/components/Logo'
import { AlertTriangle, ArrowRight } from 'lucide-react'

export const metadata = {
  title: 'Share link no longer works | granted.bio',
  robots: { index: false, follow: false },
}

export default function ExpiredSharePage() {
  return (
    <div className="min-h-screen bg-[#FAFAF9] flex flex-col">
      <header className="border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link href="/" aria-label="granted.bio home">
            <Logo height={28} />
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-600" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            This share link no longer works
          </h1>
          <p className="text-sm text-gray-600 mb-6">
            The link may have expired or been revoked by the sender. Ask them
            to send a new one, or start your own analysis on any life-science
            topic.
          </p>
          <Link
            href="/analyze"
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors text-sm"
          >
            Start your own analysis
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="text-xs text-gray-500 mt-6">
            <Link href="/samples" className="hover:text-[#E07A5F] underline">
              See sample analyses
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
