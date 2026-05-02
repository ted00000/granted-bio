import { createServerSupabaseClient } from '@/lib/supabase-server'
import Link from 'next/link'

const CATEGORIES = [
  { key: 'basic_research', label: 'Basic Research', color: 'blue' },
  { key: 'therapeutics', label: 'Therapeutics', color: 'rose' },
  { key: 'training', label: 'Training', color: 'amber' },
  { key: 'infrastructure', label: 'Infrastructure', color: 'slate' },
  { key: 'biotools', label: 'Biotools', color: 'green' },
  { key: 'other', label: 'Other', color: 'gray' },
  { key: 'digital_health', label: 'Digital Health', color: 'cyan' },
  { key: 'diagnostics', label: 'Diagnostics', color: 'purple' },
  { key: 'medical_device', label: 'Medical Device', color: 'orange' },
]

export default async function AdminDashboard() {
  const supabase = await createServerSupabaseClient()

  // Fetch overall stats
  const [
    { count: projectCount },
    { count: publicationCount },
    { count: patentCount },
    { count: trialCount },
  ] = await Promise.all([
    supabase.from('projects').select('*', { count: 'exact', head: true }),
    supabase.from('publications').select('*', { count: 'exact', head: true }),
    supabase.from('patents').select('*', { count: 'exact', head: true }),
    supabase.from('clinical_studies').select('*', { count: 'exact', head: true }),
  ])

  // Fetch category counts
  const categoryPromises = CATEGORIES.map(cat =>
    supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('primary_category', cat.key)
  )
  const categoryResults = await Promise.all(categoryPromises)
  const categoryCounts = CATEGORIES.map((cat, i) => ({
    ...cat,
    count: categoryResults[i].count || 0
  }))

  // Fetch recent jobs
  const { data: recentJobs } = await supabase
    .from('etl_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Overview of granted.bio database
        </p>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Projects</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">
            {projectCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Publications</div>
          <div className="mt-1 text-2xl font-bold text-purple-600">
            {publicationCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Patents</div>
          <div className="mt-1 text-2xl font-bold text-orange-600">
            {patentCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-5">
          <div className="text-sm font-medium text-gray-500">Clinical Trials</div>
          <div className="mt-1 text-2xl font-bold text-cyan-600">
            {trialCount?.toLocaleString() || 0}
          </div>
        </div>
      </div>

      {/* Category Distribution */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Category Distribution</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
            {categoryCounts
              .sort((a, b) => b.count - a.count)
              .map((cat) => (
                <Link
                  key={cat.key}
                  href={`/projects?category=${cat.key}`}
                  className="text-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="text-2xl font-bold text-gray-900">
                    {cat.count.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{cat.label}</div>
                </Link>
              ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Link
          href="/admin/categorization-review"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-rose-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-rose-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Review Categories</h3>
              <p className="text-sm text-gray-500">
                Audit borderline classifications
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/admin/upload"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Upload Data</h3>
              <p className="text-sm text-gray-500">
                Import NIH RePORTER CSV files
              </p>
            </div>
          </div>
        </Link>

        <Link
          href="/admin/jobs"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">View Jobs</h3>
              <p className="text-sm text-gray-500">Monitor ETL job status</p>
            </div>
          </div>
        </Link>

        <Link
          href="/chat"
          className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Search Database
              </h3>
              <p className="text-sm text-gray-500">Browse classified projects</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Jobs */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Jobs</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {recentJobs && recentJobs.length > 0 ? (
            recentJobs.map((job) => (
              <div key={job.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {job.job_type}
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(job.created_at).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    job.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : job.status === 'failed'
                      ? 'bg-red-100 text-red-800'
                      : job.status === 'running'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {job.status}
                </span>
              </div>
            ))
          ) : (
            <div className="px-6 py-8 text-center text-gray-500">
              No jobs have been run yet.{' '}
              <Link href="/admin/upload" className="text-blue-600 hover:underline">
                Upload data
              </Link>{' '}
              to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
