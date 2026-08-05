/**
 * Puppeteer + Chromium loader. On Vercel serverless we use the slim
 * `@sparticuz/chromium` binary (~40MB, purpose-built for Lambda /
 * Vercel function-size limits). Locally we fall back to a system
 * Chrome installed via Puppeteer's normal `puppeteer` package (which
 * we deliberately did NOT install to keep the bundle small) OR to a
 * standard Chrome install path when present.
 *
 * The generated PDF is deterministic and unbranded — headers/footers
 * are injected via Puppeteer's headerTemplate/footerTemplate options
 * at render time, NOT via CSS. This is the piece that would fail in
 * plain-CSS-only workflows (Chromium doesn't implement the CSS
 * `position: running()` element feature).
 */

import type { Browser, PDFOptions } from 'puppeteer-core'

// Chrome install locations to probe when running outside Vercel. Order
// matters — first match wins.
const LOCAL_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

async function localChromeExecutablePath(): Promise<string | null> {
  const { existsSync } = await import('fs')
  for (const p of LOCAL_CHROME_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

/**
 * Launch a Chromium browser. Callers MUST close it in a `finally`.
 *
 * On Vercel the launch pulls the @sparticuz/chromium binary (which
 * unpacks lazily from the deployed function's node_modules on first
 * call — ~1-2s cold start). Locally we use whatever Chrome the dev
 * machine has installed.
 */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core')

  // Detect Vercel / AWS Lambda-style serverless environment. When
  // running there, the @sparticuz/chromium package provides everything
  // needed (binary path, headless args, viewport). Locally, use
  // system Chrome so devs don't need the heavy binary.
  const isServerless = !!(
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV
  )

  if (isServerless) {
    // Using @sparticuz/chromium-min instead of @sparticuz/chromium
    // because Vercel's serverless bundler tree-shakes the binary
    // .br files out of node_modules/@sparticuz/chromium/bin — even
    // with outputFileTracingIncludes pinned. The `-min` variant
    // doesn't ship the binary in the package at all; instead we
    // pass a public CDN URL to executablePath() and the library
    // downloads + extracts to /tmp on cold start (~2s the first
    // call, cached for subsequent invocations of the same
    // function instance).
    //
    // The URL version MUST match the installed chromium-min version
    // (see package.json). Sparticuz publishes signed release tarballs
    // at github.com/Sparticuz/chromium/releases.
    const CHROMIUM_PACK_URL =
      'https://github.com/Sparticuz/chromium/releases/download/v140.0.0/chromium-v140.0.0-pack.x64.tar'
    const chromium = (await import('@sparticuz/chromium-min')).default
    return await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    })
  }

  const localPath = await localChromeExecutablePath()
  if (!localPath) {
    throw new Error(
      '[pdf/puppeteer] No local Chrome found for dev PDF generation. ' +
      'Install Chrome or Chromium, or run against a Vercel preview URL.',
    )
  }
  return await puppeteer.launch({
    executablePath: localPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
}

/**
 * Render a URL to PDF bytes. The URL is loaded, then we wait for the
 * page to signal readiness via `window.__printReady`, then invoke
 * `page.pdf()`. Header + footer templates are Puppeteer's stock
 * feature (Chromium injects them per page at PDF generation time).
 */
export interface RenderPdfOptions {
  url: string
  reportTitle: string
  generatedDate: string
  /**
   * How long to wait for `window.__printReady` before giving up.
   * Recharts SVGs typically settle in <2s. 15s is a generous ceiling
   * for large reports with many charts.
   */
  readyTimeoutMs?: number
}

export async function renderReportPdf(opts: RenderPdfOptions): Promise<Uint8Array> {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    // Standard letter viewport so any layout that depends on window
    // measurements matches the print output.
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 })

    await page.goto(opts.url, { waitUntil: 'networkidle0', timeout: 60_000 })

    // Wait for the client shell in /reports/[id]/print to flip
    // window.__printReady after Recharts finishes painting.
    await page.waitForFunction(
      '(window as unknown as { __printReady?: boolean }).__printReady === true',
      { timeout: opts.readyTimeoutMs ?? 15_000 },
    )

    const headerTemplate = buildHeaderTemplate(opts.reportTitle)
    const footerTemplate = buildFooterTemplate(opts.generatedDate)

    const pdfOptions: PDFOptions = {
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: false, // let Puppeteer's margins own the geometry
      margin: {
        top: '0.85in',
        bottom: '0.75in',
        left: '0.6in',
        right: '0.6in',
      },
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
    }

    const pdfBuffer = await page.pdf(pdfOptions)
    return pdfBuffer
  } finally {
    await browser.close().catch(() => {
      /* swallow — closing errors are cosmetic */
    })
  }
}

/**
 * Header template — Chromium injects this into every printed page's
 * top margin band. `.pageNumber` and `.totalPages` classes are
 * substituted automatically by Chromium. The first page skips the
 * header via `-webkit-print-first-page` behavior since we render the
 * cover with its own layout.
 */
function buildHeaderTemplate(reportTitle: string): string {
  const safeTitle = reportTitle
    .slice(0, 60)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `
    <div style="font-size:9pt; color:#6b7280; padding:0 0.6in; width:100%; display:flex; justify-content:space-between; align-items:baseline; border-bottom:0.5pt solid #e5e7eb; padding-bottom:6pt; -webkit-print-color-adjust:exact;">
      <span style="color:#E07A5F; font-weight:600; font-size:10pt;">granted<span style="color:#E07A5F;">.bio</span></span>
      <span>${safeTitle}</span>
    </div>
  `
}

/**
 * Footer template — © + centered page counter + generated date.
 * Chromium fills `.pageNumber` and `.totalPages` at render time.
 */
function buildFooterTemplate(generatedDate: string): string {
  const currentYear = new Date().getFullYear()
  return `
    <div style="font-size:8pt; color:#6b7280; padding:0 0.6in; width:100%; display:flex; justify-content:space-between; align-items:baseline; border-top:0.5pt solid #e5e7eb; padding-top:6pt; -webkit-print-color-adjust:exact;">
      <span>© ${currentYear} granted.bio</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      <span>${generatedDate}</span>
    </div>
  `
}
