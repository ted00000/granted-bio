// Public sample page for Radioligand Therapy for Prostate Cancer.
//
// Since 2026-09-03, /sample/[slug] pages are thin permanent redirects
// to /reports/[id]. See /sample/brain-organoids/page.tsx for the full
// rationale — same architecture applies here.
//
// Swapped 2026-09-22: previously pointed at 2ef956ba (broad
// "radioligand cancer therapy", investor persona, generated pre-audit-
// cycle). New target 53336db9 is the same domain scoped to prostate
// cancer, researcher persona, generated after the White Space Haiku
// classifier shipped — showcases the inferential-classification lift,
// the trial-quality pack, admin_ic split, FOA clustering, and cross-
// source MeSH overlap in prose. Old URL slug kept for SEO continuity.

import { permanentRedirect } from 'next/navigation'

const SAMPLE_REPORT_ID = '53336db9-2d96-4b70-9432-d2c36f39cf60'

export const metadata = {
  title:
    'Sample Intelligence Analysis — Radioligand Therapy for Prostate Cancer | granted.bio',
  description:
    'See exactly what a granted.bio intelligence analysis contains. 115 NIH-funded projects, 511 clinical trials cross-linked to CT.gov, 636 publications, and full trial-quality pack (industry engagement, rigor, MeSH overlap) synthesized into strategic narrative on the radioligand therapy for prostate cancer field. Generates in a few minutes.',
}

export default function RadioligandTherapySamplePage() {
  permanentRedirect(`/reports/${SAMPLE_REPORT_ID}`)
}
