'use client'

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
            AI-powered search across 128K NIH projects, 46K patents, and 203K publications.
            Find funded research, discover competitors, and build qualified leads.
          </p>

          {/* AI Chat CTA */}
          <div className="max-w-2xl mx-auto mb-12">
            <Link href="/chat">
              <div className="group flex items-center bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg px-8 py-6 transition-all cursor-pointer">
                <div className="flex-1 text-left">
                  <div className="text-white font-semibold text-lg mb-1">
                    Start AI Search
                  </div>
                  <div className="text-blue-100 text-sm">
                    Natural language search tailored to your role
                  </div>
                </div>
                <svg
                  className="w-6 h-6 text-white group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </div>
            </Link>
            <div className="mt-4 text-sm text-gray-500">
              or{' '}
              <Link href="/search" className="text-blue-600 hover:underline">
                browse with filters
              </Link>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto mb-16">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-blue-600">128K+</div>
              <div className="text-sm text-gray-500">NIH Projects</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-green-600">22K+</div>
              <div className="text-sm text-gray-500">Biotools Projects</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-purple-600">46K+</div>
              <div className="text-sm text-gray-500">Patents</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="text-3xl font-bold text-orange-600">203K+</div>
              <div className="text-sm text-gray-500">Publications</div>
            </div>
          </div>

          {/* Persona Cards */}
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <Link href="/chat" className="block">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left hover:shadow-lg hover:border-blue-200 transition-all">
                <div className="text-4xl mb-4">🔬</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  For Researchers
                </h3>
                <p className="text-blue-600 text-sm font-medium mb-2">
                  &ldquo;Who&apos;s funded in my area?&rdquo;
                </p>
                <p className="text-gray-600 text-sm">
                  Understand the competitive landscape before writing your R01.
                  Find competitors, collaborators, and validate novelty.
                </p>
              </div>
            </Link>

            <Link href="/chat" className="block">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left hover:shadow-lg hover:border-blue-200 transition-all">
                <div className="text-4xl mb-4">📈</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  For BD Teams
                </h3>
                <p className="text-blue-600 text-sm font-medium mb-2">
                  &ldquo;Find companies to sell to&rdquo;
                </p>
                <p className="text-gray-600 text-sm">
                  Build qualified lead lists of funded companies. Filter by
                  technology, funding level, and get PI contact information.
                </p>
              </div>
            </Link>

            <Link href="/chat" className="block">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left hover:shadow-lg hover:border-blue-200 transition-all">
                <div className="text-4xl mb-4">💰</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  For Investors
                </h3>
                <p className="text-blue-600 text-sm font-medium mb-2">
                  &ldquo;Evaluate or map a market&rdquo;
                </p>
                <p className="text-gray-600 text-sm">
                  Due diligence on specific companies or map entire market segments.
                  Track funding trajectories and competitive positioning.
                </p>
              </div>
            </Link>
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
