'use client'

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200',
        className
      )}
      aria-hidden="true"
    />
  )
}

// Common skeleton patterns
export function SkeletonText({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn('p-6 bg-white rounded-xl border border-gray-200', className)}>
      <Skeleton className="h-5 w-1/3 mb-4" />
      <SkeletonText lines={2} />
      <Skeleton className="h-10 w-24 mt-4" />
    </div>
  )
}

export function SkeletonTableRow({ columns = 4 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}

// Account page skeleton
export function AccountPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading account information">
      <span className="sr-only">Loading account information...</span>

      {/* Plan section */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <Skeleton className="h-6 w-32 mb-4" />
        <div className="flex items-center gap-4 mb-4">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-2 w-full rounded-full mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Reports section */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <Skeleton className="h-4 w-48 mb-2" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Search results skeleton
export function SearchResultsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading search results">
      <span className="sr-only">Loading search results...</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 bg-white rounded-lg border border-gray-100">
          <div className="flex items-start gap-3">
            <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <Skeleton className="h-5 w-3/4 mb-2" />
              <Skeleton className="h-4 w-full mb-1" />
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-2 mt-3">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// List page skeleton (projects, people, trials)
export function ListPageSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading items">
      <span className="sr-only">Loading items...</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 bg-white rounded-xl border border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <Skeleton className="h-5 w-2/3 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-3" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Detail page skeleton (project, trial, researcher)
export function DetailPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading details">
      <span className="sr-only">Loading details...</span>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <Skeleton className="h-8 w-2/3 mb-3" />
        <Skeleton className="h-5 w-1/2 mb-4" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-full" />
        </div>
      </div>

      {/* Content sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <Skeleton className="h-5 w-24 mb-4" />
          <SkeletonText lines={4} />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <Skeleton className="h-5 w-28 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
