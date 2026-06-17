import Link from 'next/link'
import { Logo } from '@/components/Logo'

// This draft reflects how the platform actually operates (one-shot
// $199 report purchases, free refresh within 12 months, retry credit
// for unsatisfactory generations, 3-month drill-down access). Should
// be reviewed by an attorney before launch. Clearly-marked placeholders
// remain for the legal entity name, state of incorporation, and
// governing law / forum. Don't ship without review.

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="px-6 py-4">
        <nav className="max-w-3xl mx-auto">
          <Link href="/" aria-label="granted.bio home" className="inline-flex items-center hover:opacity-80 transition-opacity">
            <Logo height={40} />
          </Link>
        </nav>
      </header>

      <main className="px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-semibold text-gray-900 mb-8">Terms of Service</h1>

          <div className="space-y-6 text-gray-700 leading-relaxed">
            <p className="text-sm text-gray-500">
              Last updated: June 14, 2026
            </p>

            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
              the granted.bio website, platform, and intelligence reports
              (collectively, the &ldquo;Service&rdquo;), operated by
              granted.bio (&ldquo;granted.bio,&rdquo; &ldquo;we,&rdquo;
              &ldquo;us&rdquo;). By accessing or using the Service, you agree
              to be bound by these Terms.
            </p>

            <Section title="1. The Service">
              <p>
                granted.bio synthesizes publicly available life-sciences
                research data — NIH-funded grants (NIH RePORTER), clinical
                trials (ClinicalTrials.gov), patents (USPTO), and publications
                (PubMed) — into cross-linked intelligence reports on topics
                you specify. The Service includes a free search interface and
                a paid report-generation product.
              </p>
            </Section>

            <Section title="2. Eligibility and accounts">
              <p>
                You must be at least 13 years old to use the Service. By
                creating an account, you represent that you meet this
                requirement and that the information you provide is accurate
                and current. You are responsible for maintaining the
                confidentiality of your account credentials and for all
                activity that occurs under your account.
              </p>
              <p>
                One account per individual. Accounts may not be shared,
                resold, or transferred without our written consent.
              </p>
            </Section>

            <Section title="3. Acceptable use">
              <p>You agree not to:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Use the Service in any way that violates applicable law.</li>
                <li>Attempt to scrape, harvest, or programmatically extract data from the Service except via interfaces we explicitly provide.</li>
                <li>Resell, sublicense, or redistribute reports, search results, or other content from the Service without our written consent.</li>
                <li>Attempt to reverse-engineer, decompile, or otherwise discover the source code of the Service.</li>
                <li>Interfere with the integrity or performance of the Service, including by introducing malicious code or attempting unauthorized access.</li>
                <li>Use the Service to harass, defame, or harm any individual or entity, including any researchers, principal investigators, or organizations named in our data.</li>
              </ul>
            </Section>

            <Section title="4. Payment and credits">
              <p>
                <strong>Pricing.</strong> Intelligence reports are sold at
                $199 per report, processed via Stripe. Prices are in U.S.
                dollars and exclude any taxes that may apply.
              </p>
              <p>
                <strong>What a report purchase includes.</strong> Each $199
                purchase grants you: (a) generation of one intelligence
                report on the topic and interpretation you select; (b) three
                months of in-platform drill-down access to every project,
                trial, patent, and publication referenced in the report from
                the date the report is generated; (c) one free{' '}
                <strong>refresh</strong> credit, valid for twelve months from
                purchase, which can be used to re-synthesize the same report
                against current NIH data; (d) one free{' '}
                <strong>retry</strong> credit per report if you are not
                satisfied with the synthesis, allowing you to refine the
                topic and regenerate at no charge, subject to the conditions
                described in Section 5.
              </p>
              <p>
                <strong>Refunds.</strong> All sales are final. The retry
                credit described in Section 5 is provided in lieu of refunds
                for synthesis quality. If you believe you were charged in
                error, contact{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a> within thirty days of purchase.
              </p>
              <p>
                <strong>Credit expiration.</strong> Generation, refresh, and
                retry credits expire twelve months from the original purchase
                date.
              </p>
            </Section>

            <Section title="5. Retry credit">
              <p>
                If you are not satisfied with the synthesis of a report you
                generated, you may use one retry credit per report to refine
                your topic and regenerate at no additional cost. Retry
                requests must be initiated within fourteen days of the
                original report&rsquo;s generation. The retry workflow walks
                you through a guided refinement and produces a new report;
                the retry credit is consumed at regeneration time.
              </p>
            </Section>

            <Section title="6. Intellectual property">
              <p>
                <strong>Underlying data.</strong> NIH-funded grant
                information, clinical trial records, USPTO patents, and
                PubMed publications are published by their respective
                government and academic publishers and remain the property of
                those publishers. granted.bio does not claim ownership over
                this underlying public data.
              </p>
              <p>
                <strong>Synthesis and reports.</strong> The cross-linked
                synthesis, narrative, structure, and analysis we generate are
                the intellectual property of granted.bio. Subject to your
                compliance with these Terms, we grant you a personal,
                non-exclusive, non-transferable, non-sublicensable license to
                access, view, download, and use the reports you purchase for
                your own internal research, investment-evaluation, or
                business-development purposes. You may share the report
                document (e.g., the PDF) with members of your organization or
                with third parties relevant to the decision the report
                informs, provided that they comply with these Terms. You may
                not publicly distribute, sell, sublicense, or use the report
                content to train AI models.
              </p>
              <p>
                <strong>Platform.</strong> The granted.bio website, software,
                logo, name, and trade dress are owned by granted.bio. You may
                not use them without written permission.
              </p>
            </Section>

            <Section title="7. Disclaimers">
              <p>
                <strong>Scope of data.</strong> Reports are derived from
                publicly available, NIH-linked datasets. Coverage is limited
                to records that intersect with NIH funding (US-centric, with
                limited international coverage), and may not reflect all
                relevant research, clinical activity, or commercial IP in a
                field.
              </p>
              <p>
                <strong>AI-generated synthesis.</strong> The narrative
                portion of each report is produced by our analysis engine,
                which currently runs on large language models provided by
                Anthropic. Every factual claim in the report is linked to
                the underlying NIH-indexed record so you can verify it.
                While we use prompting techniques designed to keep
                synthesis grounded and to surface uncertainty, AI output
                may contain errors or omissions. You are responsible for
                verifying any claim before relying on it for a material
                decision.
              </p>
              <p>
                <strong>Not investment advice.</strong> Nothing in the
                Service is investment advice, a recommendation to buy or
                sell securities, or a substitute for independent due
                diligence by a qualified professional.
              </p>
              <p>
                <strong>Not medical advice.</strong> Nothing in the Service
                is medical advice. Information about clinical trials is for
                research and intelligence purposes only.
              </p>
              <p>
                THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
                AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
                IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR
                A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, TO THE FULLEST
                EXTENT PERMITTED BY LAW.
              </p>
            </Section>

            <Section title="8. Limitation of liability">
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, granted.bio AND ITS
                AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOST
                PROFITS OR LOST DATA, ARISING OUT OF OR RELATED TO YOUR USE
                OF THE SERVICE, EVEN IF granted.bio HAS BEEN ADVISED OF THE
                POSSIBILITY OF SUCH DAMAGES.
              </p>
              <p>
                granted.bio&rsquo;s TOTAL LIABILITY FOR ANY CLAIM ARISING OUT
                OF OR RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF
                (a) THE AMOUNT YOU PAID granted.bio IN THE TWELVE MONTHS
                PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (b) $200.
              </p>
            </Section>

            <Section title="9. Indemnification">
              <p>
                You agree to indemnify and hold granted.bio harmless from any
                claim, demand, loss, or damages, including reasonable
                attorneys&rsquo; fees, arising out of your breach of these
                Terms, your use of the Service in violation of these Terms or
                applicable law, or your infringement of any third-party
                right.
              </p>
            </Section>

            <Section title="10. Termination">
              <p>
                You may stop using the Service and close your account at any
                time by emailing{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a>. We may suspend or terminate your access if you violate
                these Terms or if we discontinue the Service. Termination
                does not entitle you to a refund of fees already paid, except
                as required by law.
              </p>
              <p>
                Sections that by their nature should survive termination —
                including Sections 6, 7, 8, 9, and 12 — will survive.
              </p>
            </Section>

            <Section title="11. Changes to the Service or Terms">
              <p>
                We may modify or discontinue the Service, or any feature of
                it, at any time. We may also revise these Terms. Material
                changes will be communicated by email or in-app notice; the
                &ldquo;Last updated&rdquo; date above reflects the most
                recent revision. Continued use of the Service after a
                revision constitutes acceptance of the revised Terms.
              </p>
            </Section>

            <Section title="12. Governing law and disputes">
              <p>
                These Terms are governed by the laws of the State of
                Connecticut, without regard to its conflict-of-laws
                principles. Any dispute arising out of or relating to these
                Terms or the Service shall be resolved in the state or
                federal courts located in the State of Connecticut, and you
                consent to the personal jurisdiction of those courts.
              </p>
            </Section>

            <Section title="13. Contact">
              <p>
                Questions about these Terms? Email{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a>.
              </p>
            </Section>
          </div>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 pt-4 border-t border-gray-100">
        {title}
      </h2>
      {children}
    </section>
  )
}
