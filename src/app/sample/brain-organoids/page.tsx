// Public sample page for Brain Organoid Electrophysiology (investor persona).
//
// /sample/[slug] pages are thin permanent redirects to /reports/[id].
// The target report row is flagged is_public_sample=true so getReport()
// allows anon access, and the portal layout renders a SampleAttribution-
// Bar in place of the share bar. Sample visitors see the SAME portal
// UI a buyer would, with zero maintenance drift between the two.
//
// Added 2026-09-22 as the second live sample alongside /sample/
// radioligand-therapy. Demonstrates the investor-persona lens across a
// biotools + neuroscience-native topic where the platform's cross-
// source signals (MeSH overlap, industry engagement absence, FOA
// clustering absence, admin_ic distribution across NINDS/NIMH) power
// the strategic narrative.

import { permanentRedirect } from 'next/navigation'

const SAMPLE_REPORT_ID = 'b4bdfe2d-d0b7-4a70-9217-2e4009395011'

export const metadata = {
  title:
    'Sample Intelligence Analysis — Brain Organoid Electrophysiology | granted.bio',
  description:
    'See exactly what a granted.bio intelligence analysis contains. 122 NIH-funded projects across 70 organizations ($129.8M active), 486 cross-linked publications, and full trial-quality signal on the brain organoid electrophysiology field, synthesized into an investor-lens strategic narrative. Generates in a few minutes.',
}

export default function BrainOrganoidsSamplePage() {
  permanentRedirect(`/reports/${SAMPLE_REPORT_ID}`)
}
