// Chrome wrapper used by the four "drill-down" detail pages — project,
// trial, patent, publication. For logged-in users it renders the
// standard AppLayout (Sidebar + main). For logged-out visitors (who
// followed a link from /sample/liquid-biopsy) it renders the marketing
// nav and a soft-gate banner instead — same content underneath, no
// hard auth wall.
//
// Inner page content already assumes a fixed full-height container
// with `h-full overflow-y-auto`, so the public branch mirrors
// AppLayout's `fixed inset-0 flex` structure to keep that contract.

'use client'

import { type ReactNode } from 'react'
import { AppLayout } from './AppLayout'
import { MarketingNav } from './MarketingNav'
import { SampleGateBanner } from './SampleGateBanner'
import { useAuth } from '@/contexts/AuthContext'

interface DetailLayoutProps {
  children: ReactNode
}

export function DetailLayout({ children }: DetailLayoutProps) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#FAFAF9]">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
      </div>
    )
  }

  if (user) {
    return <AppLayout>{children}</AppLayout>
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-white overflow-hidden">
      <MarketingNav showSignIn />
      <SampleGateBanner />
      <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
    </div>
  )
}
