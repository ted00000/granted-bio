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

// Retired 2026-09-22. The liquid-biopsy sample report was generated
// 2026-09-01, before the audit-cycle work (trial-quality pack, PubMed
// MeSH, RePORTER audit fields) and the Haiku White Space classifier.
// It reads materially weaker than the current samples. Rather than
// break external links to /sample/liquid-biopsy, redirect to the
// current investor-persona sample — brain organoid electrophysiology —
// which showcases the same investor lens on a fresh topic. Buyers
// arriving via the old URL still get a live, current example instead
// of a 404.
//
// The old report row (0555ef1d) has is_public_sample=false as of the
// same date, so anon direct access to /reports/0555ef1d... is gated
// behind login. Nothing shipping today points at it anymore.

export const metadata = {
  title:
    'Sample Intelligence Analysis | granted.bio',
  description:
    'See exactly what a granted.bio intelligence analysis contains. Current samples showcase how the platform cross-links NIH funding, clinical trials, patents, and publications into strategic narrative.',
}

export default function LiquidBiopsySamplePage() {
  permanentRedirect(`/sample/brain-organoids`)
}
