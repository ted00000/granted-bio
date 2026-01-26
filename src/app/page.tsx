import Link from 'next/link'
import { Header } from '@/components/Header'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <Header />

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
            Life Sciences Grant Intelligence
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
            Discover biotools companies and research tool developers from NIH grant data.
            Our AI-powered classification identifies companies building the next generation
            of laboratory instruments, assays, and research platforms.
          </p>

          {/* Search Box */}
          <div className="max-w-2xl mx-auto mb-12">
            <Link href="/search">
              <div className="flex items-center bg-white rounded-full shadow-lg border border-gray-200 px-6 py-4 hover:shadow-xl transition-shadow cursor-pointer">
                <svg
                  className="w-5 h-5 text-gray-400 mr-3"
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
                <span className="text-gray-500">
                  Search for biotools, companies, or technologies...
                </span>
              </div>
            </Link>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-16">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-blue-600">454+</div>
              <div className="text-sm text-gray-500">Classified Projects</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-green-600">283</div>
              <div className="text-sm text-gray-500">Biotools Companies</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-purple-600">46K+</div>
              <div className="text-sm text-gray-500">Patents Indexed</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-orange-600">5K+</div>
              <div className="text-sm text-gray-500">Publications</div>
            </div>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
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
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                5-Tier Classification
              </h3>
              <p className="text-gray-600 text-sm">
                Our algorithm analyzes funding mechanism, project text, publications,
                patents, and clinical trials to identify true biotools developers.
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Confidence Scoring
              </h3>
              <p className="text-gray-600 text-sm">
                Each project receives a 0-100 confidence score with full transparency
                into which signals contributed to the classification.
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
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
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Rich Context
              </h3>
              <p className="text-gray-600 text-sm">
                View linked publications, patents, and clinical trials for each
                project to understand the full research and commercial context.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            Data sourced from NIH RePORTER. Classification powered by multi-tier
            signal analysis.
          </p>
        </div>
      </footer>
    </div>
  )
}
