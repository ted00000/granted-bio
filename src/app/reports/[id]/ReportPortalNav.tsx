'use client'

// The report portal's persistent left rail. Replaces the app-wide
// sidebar (from AppLayout) while the user is inside a report. Structure
// mirrors the app sidebar's visual system — same widths, spacing,
// active-route treatment — so the transition feels like "same product,
// different scope" rather than a different design.
//
// Sections listed here mirror the DB columns / agent outputs that back
// each destination. The counts are computed once in the layout and
// passed in so we don't refetch per section.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronLeft,
  LayoutDashboard,
  FlaskConical,
  Activity,
  Award,
  BookOpen,
  Building2,
  Users,
  Compass,
  Globe,
  Info,
} from 'lucide-react'
import { Logo } from '@/components/Logo'

export interface SectionCounts {
  projects: number
  trials: number
  patents: number
  publications: number
  organizations: number
  researchers: number
}

interface ReportPortalNavProps {
  reportId: string
  reportTitle: string
  topic: string | null
  counts: SectionCounts
  /** When null, this is a public sample page — hide the "back to Reports" link. */
  backHref?: string | null
}

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  count?: number
}

export function ReportPortalNav({
  reportId,
  reportTitle,
  topic,
  counts,
  backHref = '/reports',
}: ReportPortalNavProps) {
  const pathname = usePathname()
  const base = pathname.startsWith('/sample/')
    ? // Anchor sample routes to their own base so all nav links stay under /sample/[slug]
      pathname.split('/').slice(0, 3).join('/')
    : `/reports/${reportId}`

  // Section groups. Ordered as the reader would traverse: narrative
  // first, then the raw evidence, then the analytical layers, then
  // reference material. Each group renders as a labeled cluster.
  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: 'Overview',
      items: [
        { href: base, label: 'Dashboard', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Data',
      items: [
        { href: `${base}/projects`, label: 'Projects', icon: FlaskConical, count: counts.projects },
        { href: `${base}/trials`, label: 'Clinical Trials', icon: Activity, count: counts.trials },
        { href: `${base}/patents`, label: 'Patents', icon: Award, count: counts.patents },
        { href: `${base}/publications`, label: 'Publications', icon: BookOpen, count: counts.publications },
        { href: `${base}/organizations`, label: 'Organizations', icon: Building2, count: counts.organizations },
        { href: `${base}/researchers`, label: 'Researchers', icon: Users, count: counts.researchers },
      ],
    },
    {
      label: 'Analysis',
      items: [
        { href: `${base}/whitespace`, label: 'White Space', icon: Compass },
        { href: `${base}/market`, label: 'Market Context', icon: Globe },
      ],
    },
    {
      label: 'Reference',
      items: [
        { href: `${base}/methodology`, label: 'Methodology', icon: Info },
      ],
    },
  ]

  return (
    <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col h-full overflow-hidden">
      {/* Brand + back */}
      <div className="flex-shrink-0 px-4 pt-6 pb-4 border-b border-gray-100">
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity mb-3">
          <Logo className="h-8" />
        </Link>
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>All analyses</span>
          </Link>
        )}
      </div>

      {/* Topic anchor — always visible so the reader remembers where they are */}
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-100 bg-[#FDF2EF]/40">
        <div className="text-[10px] font-semibold text-[#E07A5F] uppercase tracking-wider mb-1">
          Analysis
        </div>
        <h1 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-3">
          {topic ?? reportTitle}
        </h1>
      </div>

      {/* Section groups */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.label} className="px-3 py-2">
            <div className="px-3 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive =
                  // Dashboard: exact match (base only), never active on sub-routes
                  item.href === base ? pathname === base : pathname === item.href
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                        transition-colors group
                        ${isActive
                          ? 'bg-gray-50 text-gray-900'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }
                      `}
                    >
                      <Icon
                        className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[#E07A5F]' : 'text-gray-400 group-hover:text-gray-600'}`}
                        strokeWidth={isActive ? 2 : 1.75}
                      />
                      <span className={`text-sm flex-1 ${isActive ? 'font-medium' : ''}`}>
                        {item.label}
                      </span>
                      {typeof item.count === 'number' && (
                        <span className={`text-[11px] tabular-nums ${isActive ? 'text-gray-600' : 'text-gray-400'}`}>
                          {item.count.toLocaleString()}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
