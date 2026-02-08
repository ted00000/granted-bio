import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="px-6 py-4">
        <nav className="max-w-3xl mx-auto">
          <Link href="/" className="text-2xl font-semibold tracking-tight text-gray-900">
            granted<span className="text-[#E07A5F]">.bio</span>
          </Link>
        </nav>
      </header>

      <main className="px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-semibold text-gray-900 mb-8">Privacy Policy</h1>

          <div className="prose prose-gray">
            <p className="text-gray-500 mb-6">
              Last updated: February 2025
            </p>

            <p className="text-gray-600 mb-6">
              This privacy policy will be updated with full details. For questions, contact{' '}
              <a href="mailto:hello@granted.bio" className="text-[#E07A5F] hover:underline">
                hello@granted.bio
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
