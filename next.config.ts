import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel's serverless bundler tree-shakes files that aren't
  // statically require()'d — including the `.br` brotli-compressed
  // Chromium binaries under @sparticuz/chromium/bin/ that get
  // extracted at runtime. Without this hint, the /api/reports/[id]/pdf
  // function throws:
  //   "The input directory '/var/task/node_modules/@sparticuz/chromium/bin'
  //    does not exist. Please provide the location of the brotli files."
  // Force-include the bin directory so the binary ships with the
  // function bundle. See:
  //   https://github.com/Sparticuz/chromium#readme
  outputFileTracingIncludes: {
    '/api/reports/[id]/pdf': [
      'node_modules/@sparticuz/chromium/**',
    ],
  },
  // Chromium + puppeteer-core pull in some Node-only deps that Next's
  // bundler shouldn't try to inline into the serverless function —
  // mark them as external so the deployed bundle references them from
  // node_modules directly.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
};

export default nextConfig;
