'use client'

// Print current page. Fires the browser's native print dialog, which
// respects our @media print stylesheet (report-portal-print.css,
// imported by the report portal layout) — that hides the sidebar +
// section header chrome and lets the main content area flow across
// pages naturally.
//
// Replaces the server-side Puppeteer PDF pipeline (removed 2026-08-31).
// The browser's Save-as-PDF option in the print dialog covers the PDF
// use case without a server round-trip, without Chromium in the
// serverless bundle, and without the formatting fragility of a
// separate print/page.tsx tree drifting away from the portal view.
//
// The button intentionally has NO owner-only gating — recipients on a
// /share/[token] view can print too.

import { Printer } from 'lucide-react'

interface PrintButtonProps {
  /** Extra class on the button. Callers pass the header-context
   *  utility classes (color, size, hover) so this can slot into
   *  either the dashboard header row or a SectionShell header. */
  className?: string
  /** Visible label. Defaults to "Print" — a section-scoped caller
   *  might want "Print section" for clarity when the page is deeply
   *  nested, though we haven't needed the override yet. */
  label?: string
}

export function PrintButton({
  className,
  label = 'Print',
}: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="Print this page (use Save as PDF in the print dialog for a PDF)"
      className={`print:hidden ${className ?? ''}`}
    >
      <Printer className="w-3.5 h-3.5" strokeWidth={1.5} />
      {label}
    </button>
  )
}
