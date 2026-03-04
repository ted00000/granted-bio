'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { FileText, ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface Report {
  id: string
  title: string
  report_type: 'topic' | 'portfolio'
  topic: string | null
  status: 'generating' | 'complete' | 'failed'
  markdown_content: string | null
  executive_summary: string | null
  project_count: number | null
  data_limited: boolean
  error_message: string | null
  created_at: string
  updated_at: string
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport()
  }, [id])

  // Poll while generating
  useEffect(() => {
    if (!report || report.status !== 'generating') return

    const interval = setInterval(fetchReport, 5000)
    return () => clearInterval(interval)
  }, [report?.status])

  const fetchReport = async () => {
    try {
      const response = await fetch(`/api/reports/${id}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch report')
      }

      setReport(data.report)
    } catch (e) {
      console.error('Error fetching report:', e)
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  const downloadMarkdown = () => {
    if (!report?.markdown_content) return

    const blob = new Blob([report.markdown_content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.title.replace(/[^a-z0-9]/gi, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#FAFAF9]">
        <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
            <div className="flex items-center justify-between">
              <Link href="/" className="text-xl font-semibold text-gray-900">
                granted<span className="text-[#E07A5F]">.bio</span>
              </Link>
              <Link
                href="/reports"
                className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium"
              >
                ← Back to Reports
              </Link>
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              {error || 'Report not found'}
            </h2>
            <Link
              href="/reports"
              className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Go back to reports
            </Link>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold text-gray-900">
              granted<span className="text-[#E07A5F]">.bio</span>
            </Link>
            <Link
              href="/reports"
              className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Reports
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        {/* Report Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-[#FDF2EF] rounded-lg">
                <FileText className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 mb-1">
                  {report.title}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>Generated {formatDate(report.created_at)}</span>
                  {report.project_count !== null && (
                    <>
                      <span>•</span>
                      <span>{report.project_count} projects analyzed</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {report.status === 'complete' && report.markdown_content && (
              <button
                onClick={downloadMarkdown}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            )}
          </div>
        </div>

        {/* Report Content */}
        {report.status === 'generating' && (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="relative inline-block mb-4">
              <FileText className="w-16 h-16 text-[#E07A5F]" strokeWidth={1.5} />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow">
                <Loader2 className="w-4 h-4 text-[#E07A5F] animate-spin" />
              </div>
            </div>
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Generating Report...
            </h2>
            <p className="text-gray-500">
              Our AI agents are gathering and analyzing data. This page will
              automatically update when the report is ready.
            </p>
          </div>
        )}

        {report.status === 'failed' && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              Report Generation Failed
            </h2>
            <p className="text-gray-500 mb-2">
              {report.error_message || 'An error occurred while generating the report.'}
            </p>
            <Link
              href="/reports"
              className="text-[#E07A5F] hover:text-[#C96A4F] font-medium"
            >
              Go back to reports
            </Link>
          </div>
        )}

        {report.status === 'complete' && report.markdown_content && (
          <div className="bg-white rounded-lg shadow-sm">
            <MarkdownRenderer content={report.markdown_content} />
          </div>
        )}
      </main>
    </div>
  )
}
