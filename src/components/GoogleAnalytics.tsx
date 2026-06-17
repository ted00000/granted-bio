'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'

// Google Analytics tag (GA4 property G-M9TGX0MW04). Uses next/script with
// strategy="afterInteractive" so the loader doesn't block hydration. The
// measurement ID is not a secret — it's embedded in every page that
// reports to GA — so it's hardcoded rather than env-gated.
//
// Admin routes (/admin/*) are excluded so internal operator traffic
// doesn't pollute conversion + behavior metrics.

const GA_MEASUREMENT_ID = 'G-M9TGX0MW04'

export function GoogleAnalytics() {
  const pathname = usePathname()

  if (pathname?.startsWith('/admin')) {
    return null
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
    </>
  )
}
