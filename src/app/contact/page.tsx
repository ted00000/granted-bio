// /contact — BD / enterprise inbound form.
//
// Used from the BD persona card on the home page ("Talk to us about
// enterprise pricing"). Fields match the LANDING_AND_CREDITS_PLAN.md
// spec: name, email, company, role, topic of interest (required),
// headcount (optional), free text.
//
// Topic of interest is the required differentiator from a generic
// contact form — it lets BD outreach be specific. If a sample report
// on that topic exists, outreach can include it; if not, the field
// gives the founder direct input on what's next-most-valuable to
// generate.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MarketingNav } from '@/components/MarketingNav'
import { ArrowRight, CheckCircle, Briefcase } from 'lucide-react'

const HEADCOUNT_OPTIONS = [
  { value: '', label: 'Select team size (optional)' },
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '500+', label: '500+' },
]

export default function ContactPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [topicOfInterest, setTopicOfInterest] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [message, setMessage] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    name.trim().length > 0 &&
    email.includes('@') &&
    company.trim().length > 0 &&
    topicOfInterest.trim().length > 0 &&
    !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          company,
          role: role || undefined,
          topicOfInterest,
          headcount: headcount || undefined,
          message: message || undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit')
      }

      setSubmitted(true)
    } catch (e) {
      console.error('Contact submit failed:', e)
      setError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav />

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm font-medium mb-4">
            <Briefcase className="w-3.5 h-3.5" />
            Business Development
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 mb-3">
            Talk to us about enterprise pricing.
          </h1>
          <p className="text-gray-600 leading-relaxed">
            For partnership scouts, licensing teams, and corporate development:
            volume pricing on intelligence reports, custom topic libraries, and
            tailored cross-source synthesis. Tell us what you&apos;re working on
            and we&apos;ll follow up with a sample on your topic within one
            business day.
          </p>
        </div>

        {submitted ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Thanks — we&apos;ll be in touch.
            </h2>
            <p className="text-gray-600 max-w-md mx-auto">
              We&apos;ll review your request and follow up within one business day with a
              sample report on your topic of interest.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 mt-6 text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Back to home
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-5"
          >
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Work email <span className="text-rose-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Company <span className="text-rose-500">*</span>
                </label>
                <input
                  id="company"
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Role
                </label>
                <input
                  id="role"
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g., Director of BD"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="topic"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Topic of interest <span className="text-rose-500">*</span>
              </label>
              <input
                id="topic"
                type="text"
                value={topicOfInterest}
                onChange={(e) => setTopicOfInterest(e.target.value)}
                required
                placeholder="e.g., siRNA delivery for liver targets"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                We&apos;ll send you a sample report tailored to this topic.
              </p>
            </div>

            <div>
              <label
                htmlFor="headcount"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Team size
              </label>
              <select
                id="headcount"
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent"
              >
                {HEADCOUNT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="message"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                What are you trying to learn or accomplish?
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="A few lines on what you're scouting, who you're trying to reach, or the decision the report would inform."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E07A5F] focus:border-transparent resize-none"
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <Link
                href="/"
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#E07A5F] text-white text-sm font-medium rounded-lg hover:bg-[#C96A4F] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Sending...' : 'Send request'}
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
