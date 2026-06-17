'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, FileText, ArrowRight } from 'lucide-react'
import { MarketingNav } from '@/components/MarketingNav'
import { SignUpModal } from '@/components/SignUpModal'
import { GenerateReportCTA } from '@/components/GenerateReportCTA'

// /pricing — the canonical pricing surface.
//
// Single product: $199 intelligence reports. The Free account tier
// exists alongside as the "browse the data before you buy" funnel
// step, not as a parallel paid SKU. The earlier two-tier presentation
// (Free vs Pro Search $49/mo) was removed 2026-06-11 with the
// simplification — the Pro Search code is preserved (commented) in
// src/lib/stripe/config.ts and src/app/api/stripe/checkout/route.ts
// for possible future revival.

export default function PricingPage() {
  const [signUpOpen, setSignUpOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main className="max-w-5xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Strategic intelligence reports priced to use, not to ration.
          </p>
        </div>

        {/* Two cards: Reports as the featured product, Free as the
            data-browsing on-ramp. */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* Intelligence Reports — primary */}
          <div className="bg-white rounded-2xl border-2 border-[#E07A5F] p-8 relative shadow-sm">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#E07A5F] text-white text-xs font-medium rounded-full">
              Get the report
            </div>

            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#FDF2EF] flex items-center justify-center">
                  <FileText className="w-4 h-4 text-[#E07A5F]" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-semibold text-gray-900">Intelligence Report</h2>
              </div>
              <p className="text-gray-600 text-sm">
                A complete cross-source synthesis on any life-sciences topic.
              </p>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-semibold text-gray-900">$199</span>
              <span className="text-gray-500"> per report</span>
            </div>

            <GenerateReportCTA
              className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors mb-8"
            >
              Generate a Report
              <ArrowRight className="w-4 h-4" />
            </GenerateReportCTA>

            <ul className="space-y-3">
              <Feature>Researcher or investor lens</Feature>
              <Feature>Full access to every linked project, trial, patent, publication</Feature>
              <Feature>3 months of in-platform drill-down access</Feature>
              <Feature>One free refresh within 12 months</Feature>
              <Feature>Refine &amp; regenerate, free, if not satisfied</Feature>
            </ul>
          </div>

          {/* Free account — the data-browsing on-ramp */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Free account</h2>
              <p className="text-gray-600 text-sm">
                Browse the underlying data and validate your topic has signal
                before you buy a report.
              </p>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-semibold text-gray-900">$0</span>
            </div>

            <button
              type="button"
              onClick={() => setSignUpOpen(true)}
              className="block w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium text-center hover:bg-gray-200 transition-colors mb-8"
            >
              Get Started Free
            </button>

            <ul className="space-y-3">
              <Feature>Semantic search across NIH RePORTER, CT.gov, USPTO, PubMed</Feature>
              <Feature>Project, trial, patent, and publication details</Feature>
              <Feature>10 searches per month</Feature>
              <Feature>Verify your topic before purchase</Feature>
            </ul>
          </div>
        </div>

        {/* Need more? — BD / enterprise punchline pointing at /contact.
            Mirrors the home page §5 footer line. */}
        <p className="text-center text-sm text-gray-500 mb-16">
          Need 5+ reports for a team?{' '}
          <Link href="/contact" className="text-[#E07A5F] hover:text-[#C96A4F] underline">
            Talk to us about volume.
          </Link>
        </p>

        {/* Time ROI — per the locked pricing-framing rule we don't lead
            with "cheaper than X"; instead we anchor on the time the
            synthesis takes to build by hand, even with AI assistance. */}
        <div className="bg-gray-50 rounded-2xl p-8 mb-16">
          <h2 className="text-xl font-semibold text-gray-900 mb-2 text-center">
            What this takes to build by hand
          </h2>
          <p className="text-sm text-gray-500 text-center mb-8 max-w-2xl mx-auto">
            Even with AI assistance, building the equivalent synthesis is
            real engineering work — querying, cross-linking, deduping, and
            verifying across 4 massive datasets.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            {/* On your own */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
                On your own
              </div>
              <h3 className="font-semibold text-gray-900 mb-4">
                The manual workflow
              </h3>
              <ul className="space-y-2.5 text-sm text-gray-600 mb-6">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Search and filter NIH RePORTER, ClinicalTrials.gov, USPTO, PubMed
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Cross-link ~100 records by project number
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Read abstracts, extract methodology and competitive signal
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  Aggregate funding stats, build visuals, write the synthesis
                </li>
              </ul>
              <div className="mt-auto pt-4 border-t border-gray-100">
                <div className="text-2xl font-semibold text-gray-900">~25 hours</div>
                <div className="text-xs text-gray-500 mt-1">
                  of analyst time, even with AI assistance
                </div>
              </div>
            </div>

            {/* With granted.bio */}
            <div className="bg-white rounded-xl border-2 border-[#E07A5F]/30 p-6 flex flex-col shadow-sm">
              <div className="text-[10px] uppercase tracking-wider text-[#E07A5F] font-semibold mb-2">
                With granted.bio
              </div>
              <h3 className="font-semibold text-gray-900 mb-4">
                The report, ready
              </h3>
              <ul className="space-y-2.5 text-sm text-gray-600 mb-6">
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  One topic, one click
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Cross-source synthesis, every reference auditable
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  Drill into every linked record for 3 months
                </li>
                <li className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  One free refresh within 12 months
                </li>
              </ul>
              <div className="mt-auto pt-4 border-t border-gray-100">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-gray-900">2 minutes</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-2xl font-semibold text-[#E07A5F]">$199</span>
                </div>
              </div>
            </div>
          </div>

          <p className="text-sm text-gray-500 text-center mt-8 max-w-2xl mx-auto italic">
            At analyst rates, the report pays for itself the first time you skip
            the manual workflow.
          </p>
        </div>

        {/* FAQ — kept short. The home page §7 FAQ does the long-form
            work; this surface only needs the most common pre-purchase
            questions specifically about pricing and access. */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            <FAQ
              question="Do I need an account to buy a report?"
              answer="Yes — a free account is required so the report ties to your login and you can drill into every linked record for the 3-month window. Signing up takes a few seconds and doesn't cost anything."
            />
            <FAQ
              question="What data sources do you use?"
              answer="NIH RePORTER (grants), ClinicalTrials.gov (active and completed trials), USPTO (patents), and PubMed (publications). All cross-linked at the project_number level so a project, its funded trials, its filed patents, and its published papers appear together."
            />
            <FAQ
              question="What's included in a report?"
              answer="Executive summary, field maturity assessment, competitive topology, funding landscape, key projects with insights, clinical validation status, patent and IP landscape, key publications, top organizations and researchers. About 30 pages of analysis, tailored to your chosen lens (researcher or investor)."
            />
            <FAQ
              question="What if I'm not happy with my report?"
              answer="We'll help you refine your search and regenerate, free. The platform asks what didn't work, our analysis engine proposes three reformulated interpretations based on your feedback, and you pick one to retry. One retry per report, within 14 days of generation."
            />
            <FAQ
              question="Do credits expire?"
              answer="12 months from purchase. Generation and refresh share the same expiry. Plenty of time to use what you bought."
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-gray-500">
          <p>granted.bio — Cross-source life-sciences intelligence</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms</Link>
          </div>
        </div>
      </footer>

      <SignUpModal
        open={signUpOpen}
        onClose={() => setSignUpOpen(false)}
        redirect="/reports"
      />
    </div>
  )
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
      <span className="text-gray-700">{children}</span>
    </li>
  )
}

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-medium text-gray-900 mb-2">{question}</h3>
      <p className="text-sm text-gray-600">{answer}</p>
    </div>
  )
}
