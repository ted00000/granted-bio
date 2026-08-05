import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Puppeteer + Chromium: mark as external so Next.js doesn't try to
  // bundle puppeteer-core's Node-only deps into the serverless
  // function output. The Chromium binary itself is fetched at
  // runtime from a public CDN via @sparticuz/chromium-min (see
  // src/lib/pdf/puppeteer.ts), so we don't need outputFileTracingIncludes
  // for it — the first attempt using the full @sparticuz/chromium
  // package failed because Vercel tree-shook the .br binaries even
  // with tracing hints.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium-min'],
};

export default nextConfig;
