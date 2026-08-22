// Shared link primitives for Data tables. Internal entity links
// (project / trial / patent / org / researcher detail pages) use
// Next.js Link with a subtle hover treatment; external links (PubMed,
// ClinicalTrials.gov, USPTO) use <a target="_blank">.
//
// Style: text stays in the surrounding gray, gains brand-coral color
// + underline on hover. Deliberately not underlined by default so a
// table full of links doesn't read as a sea of blue.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

const LINK_CLASS =
  'hover:text-[#E07A5F] hover:underline underline-offset-2 decoration-[#E07A5F]/40 transition-colors'

export function InternalLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link href={href} className={`${LINK_CLASS} ${className}`}>
      {children}
    </Link>
  )
}

export function ExternalLinkAnchor({
  href,
  children,
  showIcon = false,
  className = '',
}: {
  href: string
  children: ReactNode
  showIcon?: boolean
  className?: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-baseline gap-1 ${LINK_CLASS} ${className}`}
    >
      <span>{children}</span>
      {showIcon && <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-60" strokeWidth={2} />}
    </a>
  )
}
