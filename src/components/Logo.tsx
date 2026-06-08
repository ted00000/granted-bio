import Image from 'next/image'

interface LogoProps {
  /**
   * Pixel height fallback when no className-based sizing is supplied.
   * Default 28 (matches the prior text-xl wordmark height). When a Tailwind
   * height class is passed via className (e.g. "h-7 sm:h-10"), this prop is
   * ignored — className wins so callers can drive responsive sizing.
   */
  height?: number
  className?: string
  /** Preload via Next.js Image; use on above-the-fold headers. */
  priority?: boolean
}

// Intrinsic aspect ratio of the source PNG. Width auto-scales from height
// via the `w-auto` utility.
const INTRINSIC_W = 951
const INTRINSIC_H = 219

export function Logo({ height = 28, className = '', priority = false }: LogoProps) {
  // If the caller passes a Tailwind height class, don't lock pixel height
  // inline — let className control the rendered height responsively.
  const callerControlsHeight = /\bh-\d/.test(className)
  const intrinsicWidth = Math.round(height * (INTRINSIC_W / INTRINSIC_H))
  return (
    <Image
      src="/granted_logo.png"
      alt="granted.bio"
      width={intrinsicWidth}
      height={height}
      priority={priority}
      className={`w-auto ${className}`}
      style={callerControlsHeight ? undefined : { height: `${height}px` }}
    />
  )
}
