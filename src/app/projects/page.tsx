'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bookmark, Trash2 } from 'lucide-react'

interface SavedProject {
  id: string
  saved_at: string
  project: {
    application_id: string
    title: string
    org_name: string | null
    total_cost: number | null
    project_end: string | null
    primary_category: string | null
    activity_code: string | null
  }
}

function isProjectActive(projectEnd: string | null): boolean | null {
  if (!projectEnd) return null
  const endDate = new Date(projectEnd)
  const today = new Date()
  return endDate >= today
}

function formatCurrency(amount: number | null): string {
  if (!amount) return ''
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount}`
}

export default function MyProjectsPage() {
  const [projects, setProjects] = useState<SavedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/saved-projects')
      const data = await response.json()
      if (data.projects) {
        setProjects(data.projects)
      }
    } catch (e) {
      console.error('Error fetching saved projects:', e)
    } finally {
      setLoading(false)
    }
  }

  const removeProject = async (applicationId: string) => {
    setRemovingId(applicationId)
    try {
      await fetch(`/api/saved-projects?application_id=${applicationId}`, {
        method: 'DELETE'
      })
      setProjects(prev => prev.filter(p => p.project.application_id !== applicationId))
    } catch (e) {
      console.error('Error removing project:', e)
    } finally {
      setRemovingId(null)
    }
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
            <Link href="/chat" className="text-sm text-[#E07A5F] hover:text-[#C96A4F] font-medium">
              ← Back to Search
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:px-6">
        <div className="flex items-center gap-3 mb-8">
          <Bookmark className="w-6 h-6 text-[#E07A5F]" strokeWidth={1.5} />
          <h1 className="text-2xl font-semibold text-gray-900">My Projects</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#E07A5F] rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <Bookmark className="w-12 h-12 text-gray-300 mx-auto mb-4" strokeWidth={1.5} />
            <h2 className="text-lg font-medium text-gray-900 mb-2">No saved projects yet</h2>
            <p className="text-gray-500 mb-6">
              Save projects while browsing to keep track of interesting research.
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#E07A5F] text-white rounded-lg hover:bg-[#C96A4F] transition-colors"
            >
              Start Searching
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map((item) => {
              const { project } = item
              const active = isProjectActive(project.project_end)

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-lg shadow-sm p-4 flex items-start gap-4 group"
                >
                  <Link
                    href={`/project/${project.application_id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h3 className="text-sm font-medium text-gray-900 leading-snug group-hover:text-[#E07A5F] transition-colors">
                        {project.title}
                      </h3>
                      {project.total_cost && (
                        <span className="text-sm font-semibold text-[#E07A5F] whitespace-nowrap flex-shrink-0">
                          {formatCurrency(project.total_cost)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          active === null ? 'bg-gray-300' : active ? 'bg-emerald-400' : 'bg-rose-300'
                        }`}
                        title={active === null ? 'Unknown' : active ? 'Active' : 'Inactive'}
                      />
                      <span className="truncate">{project.org_name}</span>
                      {project.primary_category && (
                        <>
                          <span>•</span>
                          <span className="capitalize">{project.primary_category.replace(/_/g, ' ')}</span>
                        </>
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => removeProject(project.application_id)}
                    disabled={removingId === project.application_id}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors flex-shrink-0"
                    title="Remove from saved"
                  >
                    {removingId === project.application_id ? (
                      <div className="w-4 h-4 border-2 border-gray-200 border-t-rose-500 rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
