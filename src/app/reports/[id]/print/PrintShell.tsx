'use client'

import { useEffect, type ReactNode } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface ChartData {
  fundingByYear?: unknown
  categories?: unknown
  trialsByPhase?: unknown
  whiteSpace?: unknown
}

interface PrintShellProps {
  /** Legacy markdown-rendering mode. When set, PrintShell renders
   *  the full markdown via MarkdownRenderer (used before the
   *  2026-08-24 exec-summary shift, kept for the fallback path). */
  content?: string
  chartData?: ChartData
  /** Preferred mode: caller provides fully-rendered JSX. PrintShell
   *  wraps it in the .print-body container and handles the Puppeteer
   *  ready-signal exactly the same way. */
  children?: ReactNode
}

/**
 * Client shell that renders the print body and signals
 * `window.__printReady = true` once any Recharts SVGs have fully
 * painted. Puppeteer's PDF generator waits on this flag before
 * calling page.pdf().
 *
 * Two rendering modes:
 *   * `children` (new default) — caller passes JSX we render as-is.
 *   * `content` (legacy) — caller passes markdown; we render it via
 *     MarkdownRenderer. Kept for backwards compatibility until we're
 *     sure the exec-summary path is stable.
 *
 * Ready-signal logic is unchanged — polls for `.recharts-wrapper`
 * elements with actual svg children, falls back to a 20s ceiling so
 * Puppeteer never hangs on a broken render.
 */
const CHART_WIDTH_PX = 500
const CHART_HEIGHT_PX = 300

export function PrintShell({ content, chartData, children }: PrintShellProps) {
  useEffect(() => {
    let cancelled = false
    const MAX_WAIT_MS = 20_000
    const POLL_INTERVAL_MS = 150
    const start = Date.now()

    const checkReady = (): boolean => {
      const wrappers = document.querySelectorAll('.recharts-wrapper')
      if (wrappers.length === 0) return true
      for (const w of Array.from(wrappers)) {
        const svg = w.querySelector('svg')
        if (!svg || svg.children.length === 0) return false
      }
      return true
    }

    const tick = () => {
      if (cancelled) return
      if (checkReady()) {
        ;(window as unknown as { __printReady?: boolean; __printChartsRendered?: boolean }).__printReady = true
        ;(window as unknown as { __printChartsRendered?: boolean }).__printChartsRendered = true
        console.log(`[PrintShell] Ready — all charts painted in ${Date.now() - start}ms`)
        return
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        ;(window as unknown as { __printReady?: boolean; __printChartsRendered?: boolean }).__printReady = true
        ;(window as unknown as { __printChartsRendered?: boolean }).__printChartsRendered = false
        console.warn(`[PrintShell] Max wait ${MAX_WAIT_MS}ms hit — shipping without full chart hydration.`)
        return
      }
      setTimeout(tick, POLL_INTERVAL_MS)
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => tick())
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="print-body">
      {children}
      {content ? (
        <MarkdownRenderer
          content={content}
          chartData={chartData as never}
          printChartWidth={CHART_WIDTH_PX}
          printChartHeight={CHART_HEIGHT_PX}
        />
      ) : null}
    </div>
  )
}
