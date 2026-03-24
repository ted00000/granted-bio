'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  FileText,
  Trash2,
  Plus,
  AlertCircle,
  Loader2,
  CheckCircle,
  FlaskConical,
  TrendingUp,
  Check,
  ArrowRight,
  BarChart3,
  Users,
  Microscope,
  Shield,
  Clock,
} from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
import { MarketingNav } from '@/components/MarketingNav'
import { GenerateReportDialog } from './GenerateReportDialog'

interface Report {
  id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  status: 'generating' | 'complete' | 'failed'
  project_count: number | null
  data_limited: boolean
  created_at: string
  updated_at: string
}

// Marketing page for non-authenticated visitors
function ReportsLanding() {
  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      <MarketingNav showSignIn />

      <main>
        {/* Hero */}
        <section className="py-16 md:py-24 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-sm font-medium mb-6">
              <FileText className="w-4 h-4" />
              Intelligence Reports
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-gray-900 mb-6">
              Focused research intelligence<br />in minutes, not hours
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Stop keyword-searching across NIH RePORTER, ClinicalTrials.gov, PubMed, and USPTO.
              Our AI understands your topic semantically, surfaces the most relevant projects,
              and synthesizes everything into actionable intelligence.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
              >
                Generate Your Report
                <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="text-gray-500">
                <span className="text-2xl font-semibold text-gray-900">$99</span>
                <span className="text-sm ml-1">per report</span>
              </div>
            </div>
          </div>
        </section>

        {/* Value Props */}
        <section className="py-16 px-6 bg-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Minutes, Not Hours</h3>
                <p className="text-sm text-gray-600">
                  Skip hours of hit-or-miss keyword searching across NIH RePORTER,
                  ClinicalTrials.gov, PubMed, and USPTO. Get focused intelligence in minutes.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                  <Microscope className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Intelligent, Not Random</h3>
                <p className="text-sm text-gray-600">
                  AI understands your topic semantically, not just keywords. We surface the
                  most relevant projects and synthesize what actually matters.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Deep Dive Ready</h3>
                <p className="text-sm text-gray-600">
                  Every report links to the underlying data. Use our search tool to explore
                  any project, patent, or trial in detail.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-4">
              Semantic understanding, not keyword guessing
            </h2>
            <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
              Traditional database searches rely on exact keywords - you miss relevant projects
              that use different terminology. Our AI understands meaning: search for "CRISPR delivery"
              and find projects describing "guide RNA transport" or "Cas9 cellular uptake."
            </p>

            <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
              <div className="grid md:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="w-10 h-10 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center mx-auto mb-3 text-lg font-semibold">
                    1
                  </div>
                  <h3 className="font-medium text-gray-900 mb-2">Semantic Search</h3>
                  <p className="text-sm text-gray-500">
                    AI searches 4 databases for conceptual matches, not just exact text
                  </p>
                </div>
                <div>
                  <div className="w-10 h-10 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center mx-auto mb-3 text-lg font-semibold">
                    2
                  </div>
                  <h3 className="font-medium text-gray-900 mb-2">Relevance Ranking</h3>
                  <p className="text-sm text-gray-500">
                    Results ranked by semantic relevance - the most important surface first
                  </p>
                </div>
                <div>
                  <div className="w-10 h-10 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center mx-auto mb-3 text-lg font-semibold">
                    3
                  </div>
                  <h3 className="font-medium text-gray-900 mb-2">Focused Synthesis</h3>
                  <p className="text-sm text-gray-500">
                    Report analyzes top-ranked projects - signal without the noise
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What's Included */}
        <section className="py-16 px-6 bg-gray-50">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-semibold text-gray-900 text-center mb-12">
              What's in a report
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Microscope className="w-4 h-4 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Funding Landscape</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Total NIH investment and funding trends over time
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Breakdown by institute, mechanism, and funding type
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Key projects and their funding trajectories
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                    <Users className="w-4 h-4 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Competitive Landscape</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Leading institutions and their research focus
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Key investigators and their publication records
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Industry players and their IP positions
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">IP & Patent Analysis</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Patent landscape and filing trends
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Key patent holders and their portfolios
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Freedom-to-operate considerations
                  </li>
                </ul>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Clinical Development</h3>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Active trials by phase and status
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Sponsor landscape and enrollment trends
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    Regulatory pathway assessment
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Two Personas */}
        <section className="py-20 px-6 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium mb-4">
                Choose Your Lens
              </span>
              <h2 className="text-3xl md:text-4xl font-semibold text-gray-900 mb-4">
                Same data. Different insights.
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Whether you're writing an R01 or evaluating a biotech investment,
                our AI frames the analysis for your specific goals.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
              {/* Research Report */}
              <div className="bg-white rounded-2xl border-2 border-blue-100 shadow-lg shadow-blue-50/50 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                      <FlaskConical className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">Research Report</h3>
                      <p className="text-blue-100">For researchers & academics</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-gray-600 mb-6">
                    Designed for PIs, postdocs, and research teams preparing grant applications,
                    literature reviews, or exploring new research directions.
                  </p>
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
                    What you'll get
                  </h4>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Competitive landscape</span>
                        <p className="text-sm text-gray-500">Who else is working on this? What approaches are funded?</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Collaboration opportunities</span>
                        <p className="text-sm text-gray-500">Key investigators, complementary expertise, potential mentors</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Research gaps & directions</span>
                        <p className="text-sm text-gray-500">Where's the field heading? What's underfunded?</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Funding alignment</span>
                        <p className="text-sm text-gray-500">Which institutes fund this? Active RFAs and priorities</p>
                      </div>
                    </li>
                  </ul>
                  <div className="mt-6 pt-6 border-t border-gray-100">
                    <p className="text-sm text-gray-500 italic">
                      "Perfect for writing the Significance and Innovation sections of my R01."
                    </p>
                  </div>
                </div>
              </div>

              {/* Investment Report */}
              <div className="bg-white rounded-2xl border-2 border-emerald-100 shadow-lg shadow-emerald-50/50 overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 p-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                      <TrendingUp className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">Investment Report</h3>
                      <p className="text-emerald-100">For investors & BD teams</p>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <p className="text-gray-600 mb-6">
                    Built for VCs, corporate development, and BD teams evaluating opportunities,
                    conducting due diligence, or mapping competitive landscapes.
                  </p>
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
                    What you'll get
                  </h4>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Market validation</span>
                        <p className="text-sm text-gray-500">NIH funding as a proxy for scientific conviction</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Technical risk assessment</span>
                        <p className="text-sm text-gray-500">Phase distribution, mechanism maturity, key risks</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">IP landscape</span>
                        <p className="text-sm text-gray-500">Patent holders, filing trends, FTO considerations</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Clinical development</span>
                        <p className="text-sm text-gray-500">Active trials, sponsors, regulatory pathway</p>
                      </div>
                    </li>
                  </ul>
                  <div className="mt-6 pt-6 border-t border-gray-100">
                    <p className="text-sm text-gray-500 italic">
                      "Cut our due diligence time in half. Essential for any life science investment thesis."
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center mt-12">
              <p className="text-gray-500 mb-6">
                Both reports include: funding analysis, key players, publications, patents, and clinical trials
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors"
              >
                Generate Your Report - $99
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 px-6 bg-gradient-to-br from-[#E07A5F] to-[#C96A4F]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">
              Ready to accelerate your research?
            </h2>
            <p className="text-white/80 mb-8">
              Get comprehensive intelligence on any life science topic.
              No subscription required.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-[#E07A5F] rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Generate Your First Report
              <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="text-white/60 text-sm mt-4">$99 per report</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-gray-500">
          <p>granted.bio - AI-powered life science intelligence</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// Dashboard for authenticated users
function ReportsDashboard() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)

  useEffect(() => {
    fetchReports()
  }, [])

  // Poll for generating reports
  useEffect(() => {
    const generatingReports = reports.filter((r) => r.status === 'generating')
    if (generatingReports.length === 0) return

    const interval = setInterval(fetchReports, 5000)
    return () => clearInterval(interval)
  }, [reports])

  const fetchReports = async () => {
    try {
      const response = await fetch('/api/reports')
      const data = await response.json()
      if (data.reports) {
        setReports(data.reports)
      }
    } catch (e) {
      console.error('Error fetching reports:', e)
    } finally {
      setLoading(false)
    }
  }

  const deleteReport = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/reports/${id}`, { method: 'DELETE' })
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      console.error('Error deleting report:', e)
    } finally {
      setDeletingId(null)
    }
  }

  const handleReportGenerated = () => {
    setShowGenerateDialog(false)
    fetchReports()
  }

  return (
    <AppLayout>
      <div className="h-full overflow-y-auto bg-[#FAFAF9]">
        <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 pt-[calc(1rem+env(safe-area-inset-top))] lg:pt-8">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
              <h1 className="text-2xl font-semibold text-gray-900">My Reports</h1>
            </div>
            <button
              onClick={() => setShowGenerateDialog(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[#E07A5F] hover:bg-[#FDF2EF] rounded-lg transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              New Report
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="font-medium text-gray-900 mb-2">No reports yet</h3>
              <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
                Generate your first intelligence report to get comprehensive
                analysis on any life science topic.
              </p>
              <button
                onClick={() => setShowGenerateDialog(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg font-medium hover:bg-[#C96A4F] transition-colors text-sm"
              >
                Generate Report - $99
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                >
                  <Link
                    href={
                      report.status === 'complete'
                        ? `/reports/${report.id}`
                        : '#'
                    }
                    className={`flex-1 min-w-0 ${
                      report.status !== 'complete'
                        ? 'pointer-events-none'
                        : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-medium text-gray-900 leading-snug group-hover:text-[#E07A5F] transition-colors">
                        {report.title}
                      </h3>
                      <StatusBadge status={report.status} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{formatDateTime(report.created_at)}</span>
                      {report.project_count !== null && (
                        <>
                          <span>-</span>
                          <span>{report.project_count} projects</span>
                        </>
                      )}
                      {report.data_limited && (
                        <>
                          <span>-</span>
                          <span className="text-amber-500">Limited data</span>
                        </>
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => deleteReport(report.id)}
                    disabled={deletingId === report.id}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                    title="Delete report"
                  >
                    {deletingId === report.id ? (
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {showGenerateDialog && (
            <GenerateReportDialog
              onClose={() => setShowGenerateDialog(false)}
              onGenerated={handleReportGenerated}
            />
          )}
        </div>
      </div>
    </AppLayout>
  )
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function StatusBadge({ status }: { status: Report['status'] }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
        <Loader2 className="w-3 h-3 animate-spin" />
        Generating
      </span>
    )
  }
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
        <CheckCircle className="w-3 h-3" />
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700">
      <AlertCircle className="w-3 h-3" />
      Failed
    </span>
  )
}

// Main component that decides which view to show
export default function ReportsPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/reports')
      setIsAuthenticated(response.status !== 401)
    } catch {
      setIsAuthenticated(false)
    }
  }

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  // Show marketing page for visitors, dashboard for users
  return isAuthenticated ? <ReportsDashboard /> : <ReportsLanding />
}
