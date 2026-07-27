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
    // Two rAF ticks + a short settle timer — Recharts often paints its
    // SVGs on the second frame after mount, then rerenders once more if
    // ResponsiveContainer measured a different width. 250ms covers both.
    let frame1 = 0
    let frame2 = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          ;(window as unknown as { __printReady?: boolean }).__printReady = true
        }, 250)
      })
    })
    return () => {
      cancelAnimationFrame(frame1)
      cancelAnimationFrame(frame2)
      if (timer) clearTimeout(timer)
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
