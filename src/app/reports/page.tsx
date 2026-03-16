'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { FileText, Trash2, Plus, AlertCircle, Loader2, CheckCircle } from 'lucide-react'
import { AppLayout } from '@/components/AppLayout'
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

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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

export default function ReportsPage() {
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
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <FileText
              className="w-12 h-12 text-gray-300 mx-auto mb-4"
              strokeWidth={1.5}
            />
            <h2 className="text-lg font-medium text-gray-900 mb-2">
              No reports yet
            </h2>
            <p className="text-gray-500 mb-6">
              Generate intelligence reports to get comprehensive research
              landscape analysis.
            </p>
            <button
              onClick={() => setShowGenerateDialog(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[#E07A5F] hover:bg-[#FDF2EF] rounded-lg transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" strokeWidth={1.5} />
              Generate Your First Report
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
                    <span>{formatDate(report.created_at)}</span>
                    {report.project_count !== null && (
                      <>
                        <span>•</span>
                        <span>{report.project_count} projects</span>
                      </>
                    )}
                    {report.data_limited && (
                      <>
                        <span>•</span>
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
