'use client'

import { AlertCircle, RefreshCw, Home, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title?: string
  message?: string
  error?: Error | string | null
  showRetry?: boolean
  showGoBack?: boolean
  showGoHome?: boolean
  onRetry?: () => void
  className?: string
  variant?: 'card' | 'inline' | 'fullPage'
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  error,
  showRetry = true,
  showGoBack = false,
  showGoHome = false,
  onRetry,
  className,
  variant = 'card'
}: ErrorStateProps) {
  const router = useRouter()

  const errorMessage = message || (typeof error === 'string' ? error : error?.message) || 'An unexpected error occurred'

  const handleRetry = () => {
    if (onRetry) {
      onRetry()
    } else {
      window.location.reload()
    }
  }

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 text-sm text-red-600',
          className
        )}
        role="alert"
      >
        <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span>{errorMessage}</span>
        {showRetry && (
          <button
            onClick={handleRetry}
            className="text-red-700 hover:text-red-800 underline underline-offset-2"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  if (variant === 'fullPage') {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center p-6">
        <div
          className={cn(
            'max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 text-center shadow-sm',
            className
          )}
          role="alert"
          aria-live="polite"
        >
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-400" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {title}
          </h1>
          <p className="text-gray-600 mb-6">
            {errorMessage}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {showGoBack && (
              <button
                onClick={() => router.back()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Go Back
              </button>
            )}
            {showRetry && (
              <button
                onClick={handleRetry}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#E07A5F] hover:bg-[#C96A4F] rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Try Again
              </button>
            )}
            {showGoHome && (
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <Home className="w-4 h-4" aria-hidden="true" />
                Go Home
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Default card variant
  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-gray-200 p-6 text-center',
        className
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-6 h-6 text-red-400" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        {title}
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        {errorMessage}
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {showGoBack && (
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back
          </button>
        )}
        {showRetry && (
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-[#E07A5F] hover:bg-[#C96A4F] rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

// Specialized error states
export function NotFoundError({
  resource = 'Resource',
  showGoBack = true,
  showGoHome = true
}: {
  resource?: string
  showGoBack?: boolean
  showGoHome?: boolean
}) {
  return (
    <ErrorState
      title={`${resource} Not Found`}
      message={`We couldn't find the ${resource.toLowerCase()} you're looking for. It may have been removed or the link may be incorrect.`}
      showRetry={false}
      showGoBack={showGoBack}
      showGoHome={showGoHome}
      variant="fullPage"
    />
  )
}

export function LoadError({
  resource = 'data',
  onRetry
}: {
  resource?: string
  onRetry?: () => void
}) {
  return (
    <ErrorState
      title="Failed to Load"
      message={`We couldn't load the ${resource}. Please check your connection and try again.`}
      showRetry={true}
      showGoBack={false}
      onRetry={onRetry}
      variant="card"
    />
  )
}

export function UnauthorizedError() {
  return (
    <ErrorState
      title="Access Denied"
      message="You don't have permission to view this content. Please sign in with an authorized account."
      showRetry={false}
      showGoBack={true}
      showGoHome={true}
      variant="fullPage"
    />
  )
}
