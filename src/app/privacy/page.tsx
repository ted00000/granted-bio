import Link from 'next/link'
import { Logo } from '@/components/Logo'

// This draft was written to reflect how the platform actually
// processes data (account email, Stripe payments, Supabase auth,
// OpenAI embeddings, Anthropic synthesis, etc.). It should be
// reviewed by an attorney before launch — clearly-marked placeholders
// remain for the legal entity, state of incorporation, and
// jurisdiction. Don't ship without review.

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-semibold text-gray-900 mb-8">Privacy Policy</h1>

          <div className="space-y-6 text-gray-700 leading-relaxed">
            <p className="text-sm text-gray-500">
              Last updated: June 14, 2026
            </p>

            <p>
              This Privacy Policy describes how <strong>[LEGAL ENTITY NAME]</strong>{' '}
              (&ldquo;granted.bio,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects,
              uses, and shares information when you use the granted.bio website,
              platform, and intelligence reports (collectively, the
              &ldquo;Service&rdquo;).
            </p>

            <Section title="1. Information we collect">
              <p>
                <strong>Account information.</strong> When you create an
                account, we collect your email address and (optionally) your
                first name. Authentication is provided by a third-party
                identity provider (Supabase), and we receive session tokens
                and basic profile data.
              </p>
              <p>
                <strong>Payment information.</strong> When you purchase an
                intelligence report, payment is processed by Stripe, Inc. We
                do not store full card numbers or CVCs on our servers. We
                retain a record of the transaction — purchase date, amount,
                report topic, persona, and an associated Stripe customer ID
                and payment intent ID — for accounting and customer-service
                purposes.
              </p>
              <p>
                <strong>Usage data.</strong> We collect data about how you
                interact with the Service: searches you run, reports you
                generate, content you save (saved projects, trials, people),
                and timestamps of these actions.
              </p>
              <p>
                <strong>Generated content.</strong> The intelligence reports
                we synthesize for you are stored on our servers and tied to
                your account so you can access them and the linked underlying
                records during the access window described below.
              </p>
              <p>
                <strong>Inbound messages.</strong> If you contact us through
                the contact form on the Service or by email, we receive what
                you send: name, email, organization, and the content of your
                message.
              </p>
              <p>
                <strong>Technical data.</strong> Standard server logs (IP
                address, user-agent, request timestamp) and authentication
                cookies are used to operate the Service and prevent abuse.
              </p>
            </Section>

            <Section title="2. Sources of underlying research data">
              <p>
                The intelligence reports we synthesize draw on public datasets
                published by NIH RePORTER, ClinicalTrials.gov, the United
                States Patent and Trademark Office (USPTO), and PubMed. The
                content of these public records is the property of their
                respective publishers and may include personal information
                about principal investigators or other named individuals.
                granted.bio does not assert ownership of this underlying
                public data; we synthesize and cross-link it on your behalf.
              </p>
            </Section>

            <Section title="3. How we use information">
              <p>We use the information described above to:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Operate, maintain, and improve the Service.</li>
                <li>Authenticate you and protect your account.</li>
                <li>Process your payments and provide receipts.</li>
                <li>Generate intelligence reports on the topics you submit.</li>
                <li>Send service-related communications (e.g., sign-in links, payment receipts, report-ready notifications, security notices).</li>
                <li>Respond to your inquiries.</li>
                <li>Detect, prevent, and address fraud, abuse, or security incidents.</li>
                <li>Comply with our legal obligations.</li>
              </ul>
              <p>
                We do not sell your personal information. We do not use your
                personal data to train third-party AI models.
              </p>
            </Section>

            <Section title="4. Who we share information with">
              <p>
                We share information with the following categories of service
                providers, only to the extent necessary for them to provide
                their services to us:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Supabase</strong> — database, authentication, and storage.</li>
                <li><strong>Stripe</strong> — payment processing and hosted receipts.</li>
                <li><strong>Vercel</strong> — application hosting.</li>
                <li><strong>OpenAI</strong> — generating embeddings for semantic search.</li>
                <li><strong>Anthropic</strong> — generating the synthesis narrative inside intelligence reports.</li>
                <li><strong>Resend</strong> — transactional email delivery.</li>
              </ul>
              <p>
                Each of these providers operates under its own privacy
                policies and data-processing agreements. We share with them
                only what is necessary for the service they provide.
              </p>
              <p>
                We may also disclose information if required by law, subpoena,
                court order, or other valid legal process, or to protect our
                rights, our users, or the public.
              </p>
            </Section>

            <Section title="5. Data retention and access">
              <p>
                We retain your account information and generated reports for
                as long as your account remains active. After report
                generation, you have <strong>three months</strong> of in-platform
                drill-down access to every linked project, trial, patent, and
                publication referenced in the report. You may also use one
                free <strong>refresh</strong> within twelve months of purchase
                to re-synthesize the report against current NIH data.
              </p>
              <p>
                You may request deletion of your account and associated data
                at any time by emailing{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a>. We may retain certain records (e.g., financial
                transaction history) as required by law.
              </p>
            </Section>

            <Section title="6. Your rights">
              <p>
                Depending on your jurisdiction, you may have the right to:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>Access the personal data we hold about you.</li>
                <li>Correct inaccurate data.</li>
                <li>Request deletion of your data.</li>
                <li>Export your data in a portable format.</li>
                <li>Object to or restrict certain processing.</li>
              </ul>
              <p>
                To exercise these rights, email{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a>.
              </p>
            </Section>

            <Section title="7. Cookies and similar technologies">
              <p>
                We use cookies that are necessary to operate the Service,
                including authentication cookies managed by Supabase. We do
                not use advertising cookies or third-party tracking cookies.
              </p>
            </Section>

            <Section title="8. Security">
              <p>
                We use industry-standard measures to protect your data,
                including TLS encryption in transit and encryption at rest
                provided by our database and storage providers. No method of
                transmission or storage is 100% secure; you use the Service at
                your own risk.
              </p>
            </Section>

            <Section title="9. Children">
              <p>
                The Service is not directed to individuals under 13. We do
                not knowingly collect personal information from children
                under 13. If you believe a child under 13 has provided
                personal information to us, contact{' '}
                <a href="mailto:admin@granted.bio" className="text-[#E07A5F] hover:underline">
                  admin@granted.bio
                </a> and we will delete it.
              </p>
            </Section>

            <Section title="10. International users">
              <p>
                granted.bio is operated from the United States. If you access
                the Service from outside the United States, your information
                will be transferred to, stored, and processed in the United
                States or in other countries where our service providers
                operate.
              </p>
            </Section>

            <Section title="11. Changes to this policy">
              <p>
                We may update this Privacy Policy from time to time. If we
                make material changes, we will notify you by email or via the
                Service. The &ldquo;Last updated&rdquo; date above reflects
                the most recent revision.
              </p>
            </Section>

            <Section title="12. Contact">
              <p>
                Questions about this Privacy Policy or our data practices?
                Email{' '}
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
