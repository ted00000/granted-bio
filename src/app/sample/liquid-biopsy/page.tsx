// Public sample page for Liquid Biopsy For Early Cancer Detection.
//
// Since 2026-09-03, /sample/[slug] pages are thin permanent redirects
// to /reports/[id] — the report row is flagged is_public_sample=true
// so getReport() allows anon access, and the portal layout renders
// a SampleAttributionBar in place of the share bar. This gives
// samples the SAME portal UI a buyer sees, with zero maintenance
// drift between the two.
//
// Before this: this file was ~200 lines that fetched via admin
// client + rendered the raw markdown_content via MarkdownRenderer —
// the pre-portal design. Sample visitors saw meaningfully worse UX
// than what buyers get, which underrepresented the product.
//
// Metadata is preserved so the /sample/liquid-biopsy URL keeps its
// SEO. Google follows 308 permanent redirects and transfers authority
// to /reports/[id]; anyone linking to the old URL still lands on the
// right content.

import { permanentRedirect } from 'next/navigation'

const SAMPLE_REPORT_ID = '0555ef1d-3cdc-4d97-b8da-a114d2721550'

export const metadata = {
  title:
    'Sample Intelligence Analysis — Liquid Biopsy for Early Cancer Detection | granted.bio',
  description:
    'See exactly what a granted.bio intelligence analysis contains. NIH funding, clinical trials, patents, and publications synthesized into strategic narrative on the liquid biopsy field. Generates in a few minutes.',
}

export default function LiquidBiopsySamplePage() {
  permanentRedirect(`/reports/${SAMPLE_REPORT_ID}`)
}
