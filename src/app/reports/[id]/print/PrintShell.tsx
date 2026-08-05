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
// Fixed pixel dimensions for chart containers in the print route.
// Recharts' ResponsiveContainer measures its parent's width/height
// via ResizeObserver; when that measurement returns 0 or -1 (which
// happens in the print route regardless of what CSS we try), the
// SVG never renders. Forcing explicit pixel dimensions via inline
// style on the ResponsiveContainer bypasses the measurement entirely.
// 500x300 matches the layout of the main report page's charts.
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
      // Every FundingByYearChart / CategoryDistributionChart /
      // WhiteSpaceCoverageChart / TrialsByPhaseChart renders a
      // <div class="w-full"> wrapping a ResponsiveContainer. Set
      // both dimensions explicitly.
      const chartOuters = document.querySelectorAll(
        '.print-body .w-full',
      )
      for (const el of Array.from(chartOuters)) {
        if (!(el instanceof HTMLElement)) continue
        // Only touch elements that actually contain a Recharts
        // container — skip generic .w-full usages in other components.
        if (!el.querySelector('.recharts-responsive-container')) continue
        el.style.width = `${CHART_WIDTH_PX}px`
        el.style.height = `${CHART_HEIGHT_PX}px`
      }
      const responsive = document.querySelectorAll(
        '.print-body .recharts-responsive-container',
      )
      for (const el of Array.from(responsive)) {
        if (!(el instanceof HTMLElement)) continue
        el.style.width = `${CHART_WIDTH_PX}px`
        el.style.height = `${CHART_HEIGHT_PX}px`
      }
      // Kick ResizeObserver to remeasure.
      try {
        window.dispatchEvent(new Event('resize'))
      } catch {
        /* older browser, ignore */
      }
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
      />
    </div>
  )
}
