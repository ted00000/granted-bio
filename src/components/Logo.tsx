import Image from 'next/image'

interface LogoProps {
  /** Height in pixels. Default 28 (matches the prior text-xl wordmark height). */
  height?: number
  className?: string
  /** Preload via Next.js Image; use on above-the-fold headers. */
  priority?: boolean
}

// Intrinsic aspect ratio of the source PNG. Width auto-scales from height
// via the `h-{n} w-auto` Tailwind utility; the explicit width/height props
// are required by next/image but the rendered size is controlled by className.
const INTRINSIC_W = 951
const INTRINSIC_H = 219

export function Logo({ height = 28, className = '', priority = false }: LogoProps) {
  const intrinsicWidth = Math.round(height * (INTRINSIC_W / INTRINSIC_H))
  return (
    <Image
      src="/granted_logo.png"
      alt="granted.bio"
      width={intrinsicWidth}
      height={height}
      priority={priority}
      className={`w-auto ${className}`}
      style={{ height: `${height}px` }}
    />
  )
}
