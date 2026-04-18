'use client'

import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PremiumBadgeProps {
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Consistent premium/locked feature badge
 * Use 'sm' for compact contexts like sidebar navigation
 * Use 'md' (default) for cards and prominent displays
 */
export function PremiumBadge({ size = 'md', className }: PremiumBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium text-amber-600 bg-amber-50 rounded-full',
        size === 'sm' && 'gap-0.5 text-[10px] px-1.5 py-0.5',
        size === 'md' && 'gap-1 text-xs px-2 py-0.5',
        className
      )}
    >
      <Lock
        className={cn(
          size === 'sm' && 'w-2.5 h-2.5',
          size === 'md' && 'w-3 h-3'
        )}
        aria-hidden="true"
      />
      Premium
    </span>
  )
}
