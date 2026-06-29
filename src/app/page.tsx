'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  FlaskConical,
  TrendingUp,
  Briefcase,
  FileText,
} from 'lucide-react'
import { MarketingNav } from '@/components/MarketingNav'
import { AuthForm, AuthFormFallback } from '@/components/AuthForm'
import { SignUpModal } from '@/components/SignUpModal'

const stats = [
  { label: 'NIH Projects', value: '170K' },
  { label: 'Patents', value: '50K' },
  { label: 'Publications', value: '500K' },
  { label: 'Clinical Trials', value: '39K' },
]

export default function Home() {
  const [signUpOpen, setSignUpOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main>
        {/* Hero — report-as-lead framing. Left column carries the
            locked report value prop and a Sample CTA; right column
            keeps the inline auth form retitled "Browse the data free"
            so the validation step is one click rather than a
            separate signup page (Phase 4 will move it). */}
        <section className="py-16 md:py-24 px-6 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-2 gap-16 md:gap-24 items-start">
              {/* Left column */}
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#E07A5F]/10 text-[#E07A5F] rounded-full text-sm font-medium">
                    <FileText className="w-4 h-4" />
                    Intelligence Reports
                  </div>
                  <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 leading-tight">
                    A complete intelligence report on any life-sciences research topic.
                  </h1>
                  <p className="text-lg text-gray-500 leading-relaxed">
                    Cross-linking NIH funding, clinical trials, patents, and publications
                    to reveal patterns, momentum, and opportunity gaps — for grant
                    positioning, investment diligence, and partnership scouting.
                  </p>
                  <p className="text-2xl font-semibold text-gray-900 pt-2">
                    $199, generated in two minutes.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/sample/liquid-biopsy"
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
                  >
                    See a Sample Report
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a
                    href="#browse-free"
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  >
                    Browse the data free
                  </a>
                </div>

                <p className="text-xs uppercase tracking-wider text-gray-400 pt-2">
                  Data sources: NIH RePORTER · ClinicalTrials.gov · USPTO · PubMed
                </p>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 pt-6 border-t border-gray-100">
                  {stats.map((stat) => (
                    <div key={stat.label}>
                      <div className="text-2xl font-semibold text-gray-900">
                        {stat.value}
                      </div>
                      <div className="text-xs text-gray-500">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right column - Auth (the trust-building demo step) */}
              <div id="browse-free" className="w-full md:max-w-sm md:ml-auto scroll-mt-24">
                <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm w-full">
                  <h2 className="text-lg font-medium text-gray-900 mb-2">
                    Browse the data first
                  </h2>
                  <p className="text-sm text-gray-500 mb-6">
                    Free account. Search every project, trial, patent, and publication —
                    verify your topic has signal before you buy a report.
                  </p>
                  <Suspense fallback={<AuthFormFallback />}>
                    <AuthForm />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What you actually get — §2 of the plan. Three preview cards
            stand in for screenshots of the liquid biopsy sample report,
            so visitors see the shape of the artifact before clicking
            into the sample page. Numbers are pulled from that report. */}
        <section className="py-16 px-6 border-t border-gray-100 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-3">
                What you actually get
              </h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                Three layers of analysis, cross-linked. The preview below uses the public
                sample report on liquid biopsy.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-5">
              {/* Executive Summary preview — snippet pulled from the
                  current public sample report so what visitors read here
                  matches what they see when they click through. */}
              <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="text-[10px] uppercase tracking-wider text-[#E07A5F] font-semibold mb-2">
                  Executive Summary
                </div>
                <h3 className="font-semibold text-gray-900 mb-3">
                  Strategic narrative
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  Where the field is going, who&apos;s leading, where the white space sits.
                  Hedged for sample size, framed for the decision you&apos;re making.
                </p>
                <div className="mt-auto bg-white border border-gray-100 rounded-lg p-3 text-xs text-gray-500 leading-relaxed">
                  &ldquo;A clear convergence around multi-analyte, epigenomics-first
                  approaches as the dominant paradigm for improving sensitivity at
                  early disease stages&hellip;&rdquo;
                </div>
              </div>

              {/* Funding Landscape preview — totals + bar visual pulled
                  from the current sample. After the byYear coverage
                  filter, the sample's funding-by-year window is 2024-2026,
                  so the mini-chart shows three bars matching that scope. */}
              <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="text-[10px] uppercase tracking-wider text-[#E07A5F] font-semibold mb-2">
                  Funding Landscape
                </div>
                <h3 className="font-semibold text-gray-900 mb-3">
                  $102.1M across 125 projects
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  Year-over-year trajectory, top categories, leading institutions,
                  funding mechanism breakdown.
                </p>
                <div className="mt-auto flex items-end gap-2 h-16">
                  {[
                    { year: 'FY24', pct: 78 },
                    { year: 'FY25', pct: 100 },
                    { year: 'FY26', pct: 6 },
                  ].map(({ year, pct }) => (
                    <div
                      key={year}
                      className="flex-1 bg-[#E07A5F]/30 rounded-t"
                      style={{ height: `${pct}%` }}
                    />
                  ))}
                </div>
                <div className="flex gap-2 mt-1.5">
                  {['FY24', 'FY25', 'FY26'].map((y) => (
                    <span key={y} className="flex-1 text-center text-[10px] text-gray-400">
                      {y}
                    </span>
                  ))}
                </div>
              </div>

              {/* IP Landscape preview — the liquid biopsy NIH-linked
                  patent slice is small (6 patents, all academic). The
                  card reflects that honestly: patent counts per assignee,
                  not fabricated industry share bars. */}
              <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="text-[10px] uppercase tracking-wider text-[#E07A5F] font-semibold mb-2">
                  IP Landscape
                </div>
                <h3 className="font-semibold text-gray-900 mb-3">
                  Linked patents &amp; holders
                </h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-4">
                  USPTO patents cross-linked to NIH-funded projects. Holder
                  concentration, filing recency, FTO context.
                </p>
                <div className="mt-auto space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">Top assignees</span>
                    <span className="text-gray-400">patents</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { name: 'Johns Hopkins', count: 3 },
                      { name: 'Dana-Farber', count: 2 },
                      { name: 'Cornell', count: 1 },
                    ].map((row) => (
                      <div key={row.name} className="flex items-center gap-2 text-xs">
                        <span className="w-24 truncate text-gray-700">{row.name}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded">
                          <div
                            className="h-full bg-[#E07A5F]/50 rounded"
                            style={{ width: `${(row.count / 3) * 100}%` }}
                          />
                        </div>
                        <span className="text-gray-500 w-3 text-right">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Full TOC — the 3 hero cards above show the most
                visually-rich previews; this strip names every section
                so the visitor sees the report's actual breadth.
                Sections are listed in the order they appear in the
                generated report. */}
            <div className="mt-10">
              <p className="text-xs uppercase tracking-wider text-gray-400 text-center mb-4">
                Every report includes
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-4xl mx-auto">
                {[
                  'Executive Summary',
                  'Field Maturity',
                  'Competitive Topology',
                  'Funding Landscape',
                  'Market Context',
                  'Clinical Validation',
                  'IP Landscape',
                  'Key Publications',
                ].map((section) => (
                  <div
                    key={section}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 text-center"
                  >
                    {section}
                  </div>
                ))}
              </div>
            </div>

            <p className="text-sm text-gray-500 text-center mt-8 max-w-2xl mx-auto leading-relaxed italic">
              Every claim in the report links to the underlying project, trial, patent,
              or publication. Drill into any reference, see the original abstract, follow
              the data — for 3 months from purchase.
            </p>
            <div className="text-center mt-6">
              <Link
                href="/sample/liquid-biopsy"
                className="inline-flex items-center gap-2 text-[#E07A5F] hover:text-[#C96A4F] font-medium text-sm"
              >
                See the full sample report
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* How It Works — 4-step flow matching the locked wireframe.
            Replaces the previous Without/With granted.bio comparison
            because the new positioning anchors on the report as the
            artifact, not on search-vs-keyword friction. */}
        <section className="py-16 px-6 bg-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 text-center mb-4">
              How it works
            </h2>
            <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
              Reports generate in two minutes and include three months of in-platform exploration.
            </p>

            <div className="grid md:grid-cols-4 gap-6">
              {[
                {
                  step: 1,
                  title: 'Choose your topic',
                  body: 'Type a research area in your own words. Anything specific enough to define a field works.',
                },
                {
                  step: 2,
                  title: 'Pick an interpretation',
                  body: 'We propose three scopes — Narrow, Standard, Broad — so you decide how wide to cast.',
                },
                {
                  step: 3,
                  title: 'We synthesize',
                  body: 'Projects, trials, patents, publications cross-linked and analyzed. About two minutes.',
                },
                {
                  step: 4,
                  title: 'You explore',
                  body: 'The report renders as a navigable document. Every reference stays live for 3 months.',
                },
              ].map(({ step, title, body }) => (
                <div
                  key={step}
                  className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex flex-col"
                >
                  <div className="w-8 h-8 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] font-semibold flex items-center justify-center mb-4">
                    {step}
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who It's For — persona priority ordering locked in the plan:
            Researcher (lead) > Investor > BD. BD has a different CTA
            ("Talk to us") because the BD motion is enterprise, not
            self-serve. */}
        <section className="py-20 px-6 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-semibold text-gray-900 mb-4">
                Who it's for
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Three audiences, one report. Each draws different value from the same
                cross-source synthesis.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Researcher — lead persona */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <FlaskConical className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Researchers</h3>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">
                    Position your work in the funding landscape. See what's accelerating,
                    who's converging, where the white space is. A competitive map of your
                    field that takes hours instead of weeks.
                  </p>
                  <p className="text-xs text-gray-500 mt-auto">
                    Used for: grant positioning, identifying collaborators, gap analysis.
                  </p>
                </div>
              </div>

              {/* Investor */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Investors</h3>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">
                    Pre-private signal on what's becoming a market. NIH funding precedes
                    commercial activity by 3-7 years. Get a defensible view of the underlying
                    science before a pitch deck shows up.
                  </p>
                  <p className="text-xs text-gray-500 mt-auto">
                    Used for: thesis development, technical diligence, identifying overlooked platforms.
                  </p>
                </div>
              </div>

              {/* BD — enterprise motion, different CTA */}
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-5 text-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
                      <Briefcase className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold">Business Development</h3>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">
                    Identify partnership and licensing targets earlier. Surface PIs and
                    institutions producing the technology you need before they&apos;re on
                    everyone else&apos;s list.
                  </p>
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-700 font-medium mb-1"
                  >
                    Talk to us about enterprise pricing
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Intelligence Reports CTA */}
        <section className="py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 md:p-12 text-white">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-sm mb-4">
                    <FileText className="w-4 h-4" />
                    Intelligence Reports
                  </div>
                  <h2 className="text-2xl md:text-3xl font-semibold mb-4">
                    Weeks of cross-source work, done in two minutes.
                  </h2>
                  <p className="text-gray-300 mb-6">
                    Cross-source synthesis of NIH funding, clinical trials, patents, and
                    publications — analyzed into strategic narrative on where a field is going,
                    who's leading, and where the opportunity gaps sit. Generated in two minutes.
                  </p>
                  <Link
                    href="/sample/liquid-biopsy"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
                  >
                    See a Sample Report
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
                <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                  <div className="text-center">
                    <div className="text-4xl font-semibold mb-2">$199</div>
                    <div className="text-gray-400 mb-4">per report</div>
                    <ul className="text-sm text-gray-300 space-y-2 text-left">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        Complete report (PDF + web)
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        3 months of in-platform drill-down access
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        One free refresh within 12 months
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-[#E07A5F]" />
                        Refine &amp; regenerate if not satisfied
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ — answers the most common pre-purchase questions before the
            Final CTA. Uses native <details> so it's accessible and works
            without client-side state. */}
        <section className="py-16 px-6 bg-white border-y border-gray-100">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 text-center mb-12">
              Frequently asked questions
            </h2>
            <div className="space-y-3">
              {[
                {
                  q: "What's in a report?",
                  a: 'A complete synthesized intelligence report — executive summary, field maturity assessment, competitive topology, funding landscape, key projects with insights, market context, clinical validation status, patent and IP landscape, key publications, top organizations and researchers. About 30 pages of analysis. See the sample for a real example.',
                },
                {
                  q: 'What data sources do you use?',
                  a: 'NIH RePORTER (federal grants), ClinicalTrials.gov (active and completed trials), USPTO (patents), and PubMed (publications). All cross-linked at the project_number level so a project, its funded trials, its filed patents, and its published papers appear together.',
                },
                {
                  q: 'How accurate is the AI synthesis?',
                  a: 'The data layer is deterministic — every claim links to the underlying NIH-indexed record. The narrative layer runs through our analysis engine with strict sample-aware framing: hedged language, small-N caveats, and explicit acknowledgment of what NIH-linked data does and does not capture. Reports are auditable; the methodology section explains exactly how each section was generated.',
                },
                {
                  q: 'What does "3 months of access" include?',
                  a: 'Three months from generation to navigate the report inside the platform — click any project, trial, patent, or publication reference and explore the underlying record. The PDF is yours to keep; the in-platform exploration is what the three months gates.',
                },
                {
                  q: 'What does the free refresh do?',
                  a: 'Within 12 months of purchase you can re-synthesize the same report against current NIH data, free. NIH RePORTER updates monthly; if material new projects or trials appear in your topic during your window, refresh gives you the updated picture without paying again.',
                },
                {
                  q: "What if I'm not happy with my report?",
                  a: "We'll help you refine your search and regenerate, free. The platform asks what didn't work, our analysis engine proposes three reformulated interpretations based on your feedback, and you pick one to retry. One retry per report, within 14 days of generation.",
                },
                {
                  q: 'Can I share the PDF with my team?',
                  a: 'Yes — the PDF is yours. In-platform exploration of every linked record is tied to your account for the 3-month window.',
                },
                {
                  q: 'Do credits expire?',
                  a: '12 months from purchase. Generation and refresh share the same expiry. Plenty of time to use what you bought.',
                },
              ].map(({ q, a }, i) => (
                <details
                  key={i}
                  className="group border border-gray-200 rounded-xl px-5 py-4 bg-white hover:border-gray-300 transition-colors"
                >
                  <summary className="flex items-center justify-between cursor-pointer list-none gap-3">
                    <span className="font-medium text-gray-900 text-sm">{q}</span>
                    <span className="text-gray-400 group-open:rotate-45 transition-transform text-lg leading-none">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-gray-600 leading-relaxed">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 px-6 bg-gradient-to-br from-[#E07A5F] to-[#C96A4F]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">
              Start with a free account.
            </h2>
            <p className="text-white/80 mb-8">
              Browse the data, validate your topic has signal, then generate a report when ready.
            </p>
            <button
              type="button"
              onClick={() => setSignUpOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#E07A5F] rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Get Started Free
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-gray-400">
            Data from NIH RePORTER, ClinicalTrials.gov, USPTO & PubMed
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a href="mailto:hello@granted.bio" className="hover:text-gray-600 transition-colors">
              Contact
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>

      <SignUpModal
        open={signUpOpen}
        onClose={() => setSignUpOpen(false)}
      />
    </div>
  )
}
