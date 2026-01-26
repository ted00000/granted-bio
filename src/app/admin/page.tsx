import { createServerSupabaseClient } from '@/lib/supabase-server'
import Link from 'next/link'

export default async function AdminDashboard() {
  const supabase = await createServerSupabaseClient()

  // Fetch stats
  const [
    { count: projectCount },
    { count: biotoolsCount },
    { count: publicationCount },
    { count: patentCount },
  ] = await Promise.all([
    supabase.from('projects').select('*', { count: 'exact', head: true }),
    supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .gte('biotools_confidence', 50),
    supabase.from('publications').select('*', { count: 'exact', head: true }),
    supabase.from('patents').select('*', { count: 'exact', head: true }),
  ])

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
          Overview of your granted.bio database
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-500">Total Projects</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">
            {projectCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-500">
            Biotools Companies (50%+)
          </div>
          <div className="mt-2 text-3xl font-bold text-green-600">
            {biotoolsCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-500">Publications</div>
          <div className="mt-2 text-3xl font-bold text-purple-600">
            {publicationCount?.toLocaleString() || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-500">Patents</div>
          <div className="mt-2 text-3xl font-bold text-orange-600">
            {patentCount?.toLocaleString() || 0}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
          href="/search"
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
