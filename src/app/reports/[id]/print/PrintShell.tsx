'use client'

import { useEffect } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface ChartData {
  fundingByYear?: unknown
  categories?: unknown
  trialsByPhase?: unknown
  whiteSpace?: unknown
}

interface PrintShellProps {
  content: string
  chartData?: ChartData
}

/**
 * Client shell that renders the same MarkdownRenderer used by the web
 * view, then signals `window.__printReady = true` after the first two
 * animation frames — which gives Recharts a chance to mount, measure,
 * and paint SVGs. Puppeteer's PDF generation waits on this flag before
 * calling page.pdf().
 *
 * Why not window.load: recharts uses ResponsiveContainer + requestAnimationFrame
 * for its layout, so the load event fires BEFORE charts have final geometry.
 * Two frames of rAF is empirically enough for the SVG paths to settle.
 */
export function PrintShell({ content, chartData }: PrintShellProps) {
  useEffect(() => {
    // First pass (r54 fix): the previous "2 rAF + 250ms" hack set
    // window.__printReady optimistically, but Recharts' ResponsiveContainer
    // uses ResizeObserver which doesn't reliably fire on headless
    // Chromium's initial layout. Result: SVGs stayed empty, Puppeteer
    // waited 15s (which then only checked the flag, not the SVGs),
    // and PDF shipped with no charts.
    //
    // Rewritten: actively wait for actual <svg> elements inside every
    // .recharts-wrapper. Trigger a resize event first to nudge
    // ResizeObserver. Poll every 100ms up to 20s. Set __printReady
    // once ALL wrappers have an SVG child, OR once the max wait
    // elapses (fail-open so we still ship SOMETHING rather than
    // hanging forever).
    let cancelled = false
    const MAX_WAIT_MS = 20_000
    const POLL_INTERVAL_MS = 100
    const start = Date.now()

    const kickResize = () => {
      // Some ResizeObserver implementations only fire on actual size
      // changes. Dispatching a resize event is a widely-used workaround
      // that forces Recharts' ResponsiveContainer to remeasure and
      // re-render.
      try {
        window.dispatchEvent(new Event('resize'))
      } catch {
        /* older browser, ignore */
      }
    }

    const checkReady = (): boolean => {
      const wrappers = document.querySelectorAll('.recharts-wrapper')
      // If there are no charts in this report (e.g., a topic with no
      // funding-by-year data), we're trivially ready.
      if (wrappers.length === 0) return true
      // Every wrapper must contain at least one SVG element for us to
      // consider hydration complete.
      let allPainted = true
      for (const w of Array.from(wrappers)) {
        if (!w.querySelector('svg')) {
          allPainted = false
          break
        }
      }
      return allPainted
    }

    const tick = () => {
      if (cancelled) return
      kickResize()
      if (checkReady()) {
        ;(window as unknown as { __printReady?: boolean; __printChartsRendered?: boolean }).__printReady = true
        ;(window as unknown as { __printChartsRendered?: boolean }).__printChartsRendered = true
        console.log(`[PrintShell] Ready — all charts painted in ${Date.now() - start}ms`)
        return
      }
      if (Date.now() - start > MAX_WAIT_MS) {
        // Fail-open: ship the PDF even if some charts didn't paint.
        // Better a report missing a chart than no report at all.
        ;(window as unknown as { __printReady?: boolean; __printChartsRendered?: boolean }).__printReady = true
        ;(window as unknown as { __printChartsRendered?: boolean }).__printChartsRendered = false
        console.warn(`[PrintShell] Max wait ${MAX_WAIT_MS}ms hit — shipping without full chart hydration.`)
        return
      }
      setTimeout(tick, POLL_INTERVAL_MS)
    }

    // First tick after 2 rAF so React's initial commit has finished
    // and the .recharts-wrapper divs exist in the DOM to poll for.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => tick())
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="print-body">
      <MarkdownRenderer
        content={content}
        chartData={chartData as never}
      />
    </div>
  )
}
