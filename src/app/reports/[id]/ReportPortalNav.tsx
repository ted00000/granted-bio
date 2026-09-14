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

import { useEffect, useState } from 'react'
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
  Sparkles,
  Gauge,
  Network,
  DollarSign,
  Menu,
  X,
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
  /** URL prefix for section links — `/reports/[id]` in owner view,
   *  `/share/[token]` in share view. When absent, derived from
   *  pathname for legacy sample-page callers. */
  basePath?: string
  /** When null, this is a share view — hide the back link entirely
   *  (recipients don't have a My Analyses list to go back to). When
   *  set to `/reports`, the label reads "All analyses" (owner view).
   *  When set to `/samples`, the label reads "All samples" (public
   *  sample view). Any other path defaults to the generic "Back"
   *  label. */
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
  basePath,
  backHref = '/reports',
}: ReportPortalNavProps) {
  const pathname = usePathname()
  // Mobile off-canvas state. On lg+ the sidebar is static and this
  // is unused. On mobile the sidebar is fixed + translated off-screen
  // by default; the hamburger toggles it in. Auto-close whenever the
  // path changes so tapping a section swaps content AND dismisses.
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])
  // Prefer the explicit basePath (set by the report layout) so share
  // views correctly prefix every section link with /share/[token].
  // Fall back to path-derived defaults for the sample pages which
  // don't pass basePath through.
  const base = basePath
    ?? (pathname.startsWith('/sample/')
      ? pathname.split('/').slice(0, 3).join('/')
      : `/reports/${reportId}`)

  // Section groups. Order reflects reading intent: the dashboard is
  // the "what's happening + what should I do" landing pad; Analysis
  // groups the discrete analytical outputs (each a shareable URL);
  // Data groups the raw evidence tables; Reference holds methodology.
  //
  // Next Steps intentionally NOT its own page — it lives on the
  // dashboard next to the exec summary, per the "situational
  // awareness + recommended action" dashboard pattern. See
  // dashboard rewrite 2026-08-11 for rationale.
  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: 'Overview',
      items: [
        { href: base, label: 'Dashboard', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Analysis',
      // Ordered as: quick hits -> state of field -> where money flows
      // -> how the space is organized -> what is missing -> commercial
      // framing. Roughly the traversal a first-time analyst would do.
      items: [
        { href: `${base}/surprising`, label: 'What Surprised Us', icon: Sparkles },
        { href: `${base}/field-maturity`, label: 'Field Maturity', icon: Gauge },
        { href: `${base}/funding`, label: 'Funding Landscape', icon: DollarSign },
        { href: `${base}/competitive-topology`, label: 'Competitive Topology', icon: Network },
        { href: `${base}/whitespace`, label: 'White Space', icon: Compass },
        { href: `${base}/market`, label: 'Market Context', icon: Globe },
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
      label: 'Reference',
      items: [
        { href: `${base}/methodology`, label: 'Methodology', icon: Info },
      ],
    },
  ]

  return (
    <>
      {/* Mobile hamburger — fixed top-left on <lg only. Positioned
          below the attribution bar's ~50px height plus safe-area
          inset so it doesn't collide with "All samples" / "Shared
          by X" on the left side of the bar. On owner view (no
          attribution bar) there's just an extra ~50px of top space
          — acceptable for the trade of not doing dynamic
          positioning based on presence-of-attribution-bar. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-controls="report-portal-nav"
        aria-label="Open analysis menu"
        className="lg:hidden fixed top-[calc(env(safe-area-inset-top)+56px)] left-3 z-30 p-2 rounded-lg bg-white shadow-md border border-gray-200 print:hidden"
      >
        <Menu className="w-5 h-5 text-gray-700" aria-hidden="true" />
      </button>

      {/* Overlay backdrop — only rendered when the drawer is open. */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="report-portal-nav"
        className={`
          fixed lg:static inset-y-0 left-0 z-50 lg:z-auto
          w-72 flex-shrink-0 bg-white border-r border-gray-100
          flex flex-col h-full overflow-hidden
          transform transition-transform duration-200 ease-in-out
          pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          print:hidden
        `}
      >
        {/* Mobile close button — inline in the header on <lg only. */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close analysis menu"
          className="lg:hidden absolute top-3 right-3 z-10 p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

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
            <span>
              {backHref === '/samples'
                ? 'All samples'
                : backHref === '/reports'
                  ? 'All analyses'
                  : 'Back'}
            </span>
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
    </>
  )
}
