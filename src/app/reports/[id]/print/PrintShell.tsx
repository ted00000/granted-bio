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
// Fixed pixel dimensions for chart components in the print route.
// After many rounds of CSS !important overrides not reliably working
// in headless Chromium, we now bypass ResponsiveContainer entirely:
// chart components accept fixedWidth/fixedHeight props and render
// <BarChart width height> directly with no measurement chain.
// 500x300 matches the visual size of charts on the web report.
const CHART_WIDTH_PX = 500
const CHART_HEIGHT_PX = 300

export function PrintShell({ content, chartData }: PrintShellProps) {
  useEffect(() => {
    // Two responsibilities:
    // 1. Force explicit pixel dimensions on every Recharts container
    //    the moment they mount, so ResponsiveContainer has definite
    //    parent geometry and its ResizeObserver produces real numbers.
    // 2. Poll for actual <svg> children in every wrapper, then flip
    //    window.__printReady so Puppeteer knows we're done.
    //
    // r54 audit history: prior attempts using pure CSS (max-width,
    // width:100%, min-width, forcing height on .my-4 wrappers) all
    // failed because MarkdownRenderer uses .my-4 for charts +
    // blockquotes + tables — CSS scoped to .my-4 clobbered
    // non-chart layout. Doing this in JS is surgical and avoids that.
    let cancelled = false
    const MAX_WAIT_MS = 20_000
    const POLL_INTERVAL_MS = 150
    const start = Date.now()

    const forceChartDims = () => {
      // No-op now that chart components render at fixed pixel
      // dimensions directly via fixedWidth/fixedHeight props on
      // MarkdownRenderer. Kept as an anchor for the tick loop in
      // case future refactors want to re-introduce DOM tweaks.
    }

    const checkReady = (): boolean => {
      const wrappers = document.querySelectorAll('.recharts-wrapper')
      if (wrappers.length === 0) return true
      for (const w of Array.from(wrappers)) {
        const svg = w.querySelector('svg')
        // Empty scaffolding SVG (no children yet) doesn't count.
        if (!svg || svg.children.length === 0) return false
      }
      return true
    }

    const tick = () => {
      if (cancelled) return
      forceChartDims()
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
      <MarkdownRenderer
        content={content}
        chartData={chartData as never}
        printChartWidth={CHART_WIDTH_PX}
        printChartHeight={CHART_HEIGHT_PX}
      />
    </div>
  )
}
