// Public sample page for Radioligand Cancer Therapy.
//
// Since 2026-09-03, /sample/[slug] pages are thin permanent redirects
// to /reports/[id]. See /sample/liquid-biopsy/page.tsx for the full
// rationale — same architecture applies here.

import { permanentRedirect } from 'next/navigation'

const SAMPLE_REPORT_ID = '2ef956ba-8aa8-45a2-81b7-50010fe353e1'

export const metadata = {
  title:
    'Sample Intelligence Analysis — Radioligand Cancer Therapy | granted.bio',
  description:
    'See exactly what a granted.bio intelligence analysis contains. NIH funding, clinical trials, patents, and publications synthesized into strategic narrative on the radioligand therapy field — 121 projects, 70 trials, $113.8M in active NIH commitments. Generates in a few minutes.',
}

export default function RadioligandTherapySamplePage() {
  permanentRedirect(`/reports/${SAMPLE_REPORT_ID}`)
}
